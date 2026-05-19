

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_chat_owner_as_participant"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.collaborative = true THEN
        INSERT INTO chat_participants (chat_id, user_id, role, permissions)
        VALUES (
            NEW.id, 
            NEW.user_id, 
            'owner',
            '{"can_send_messages": true, "can_invite_others": true, "can_moderate": true, "can_manage_room": true}'
        )
        ON CONFLICT (chat_id, user_id) DO UPDATE SET
            role = 'owner',
            permissions = '{"can_send_messages": true, "can_invite_others": true, "can_moderate": true, "can_manage_room": true}';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."add_chat_owner_as_participant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_credits"("p_user_id" "uuid", "p_amount" integer, "p_type" "text", "p_stripe_payment_id" "text" DEFAULT NULL::"text", "p_price_paid" numeric DEFAULT NULL::numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_current_balance INTEGER;
    v_new_balance INTEGER;
BEGIN
    -- Get current balance with lock
    SELECT balance INTO v_current_balance
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    -- Calculate new balance
    v_new_balance := v_current_balance + p_amount;
    
    -- Update balance
    UPDATE user_credits
    SET balance = v_new_balance,
        total_purchased = CASE 
            WHEN p_type = 'purchase' THEN total_purchased + p_amount 
            ELSE total_purchased 
        END,
        last_purchase_at = CASE 
            WHEN p_type = 'purchase' THEN NOW() 
            ELSE last_purchase_at 
        END
    WHERE user_id = p_user_id;
    
    -- Record transaction
    INSERT INTO credit_transactions (
        user_id, type, amount, balance_after,
        stripe_payment_intent_id, price_paid
    ) VALUES (
        p_user_id, p_type, p_amount, v_new_balance,
        p_stripe_payment_id, p_price_paid
    );
END;
$$;


ALTER FUNCTION "public"."add_credits"("p_user_id" "uuid", "p_amount" integer, "p_type" "text", "p_stripe_payment_id" "text", "p_price_paid" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_generate_invite_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.collaborative = true AND NEW.invite_code IS NULL THEN
        NEW.invite_code = generate_invite_code();
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_generate_invite_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_session_duration"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL THEN
        NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at));
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calculate_session_duration"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_user_create_machine"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_limits RECORD;
    v_machine_count INTEGER;
BEGIN
    -- Get user limits
    SELECT * INTO v_limits
    FROM machine_limits
    WHERE user_id = p_user_id;
    
    -- If no limits exist, use defaults
    IF NOT FOUND THEN
        -- Create default limits for user
        INSERT INTO machine_limits (user_id)
        VALUES (p_user_id)
        ON CONFLICT (user_id) DO NOTHING;
        
        -- Use default limit of 1 machine
        RETURN TRUE;
    END IF;
    
    -- Count existing machines
    SELECT COUNT(*) INTO v_machine_count
    FROM user_machines
    WHERE user_id = p_user_id
    AND status NOT IN ('deleting', 'error');
    
    RETURN v_machine_count < v_limits.max_machines;
END;
$$;


ALTER FUNCTION "public"."can_user_create_machine"("p_user_id" "uuid") OWNER TO "postgres";


-- OUT columns are prefixed with ``out_`` (migration 015) for defence-in-depth
-- against the RETURNS-TABLE shadowing footgun that caused the
-- update_subscription_status 42702 bug (NEW-1).  Body uses table aliases on
-- chat_participants so the column reference can never shadow the OUT param.
CREATE OR REPLACE FUNCTION "public"."can_user_join_room"("p_invite_code" "text", "p_user_id" "uuid") RETURNS TABLE("out_chat_id" "uuid", "out_can_join" boolean, "out_reason" "text")
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_invitation RECORD;
    v_chat RECORD;
    v_participant_count INTEGER;
BEGIN
    -- Check if invitation exists and is valid
    SELECT i.*, c.max_participants, c.is_collaborative
    INTO v_invitation
    FROM chat_invitations i
    JOIN chats c ON i.chat_id = c.id
    WHERE i.invite_code = p_invite_code
    AND i.is_active = true
    AND (i.expires_at IS NULL OR i.expires_at > CURRENT_TIMESTAMP)
    AND (i.max_uses IS NULL OR i.uses_count < i.max_uses);

    IF NOT FOUND THEN
        RETURN QUERY SELECT NULL::UUID, false, 'Invalid or expired invitation code';
        RETURN;
    END IF;

    -- Check if user is already a participant
    IF EXISTS (
        SELECT 1 FROM chat_participants cp
        WHERE cp.chat_id = v_invitation.chat_id AND cp.user_id = p_user_id
    ) THEN
        RETURN QUERY SELECT v_invitation.chat_id, false, 'You are already a participant in this room';
        RETURN;
    END IF;

    -- Check if room is at capacity
    SELECT COUNT(*) INTO v_participant_count
    FROM chat_participants cp
    WHERE cp.chat_id = v_invitation.chat_id;

    IF v_participant_count >= v_invitation.max_participants THEN
        RETURN QUERY SELECT v_invitation.chat_id, false, 'Room is at maximum capacity';
        RETURN;
    END IF;

    RETURN QUERY SELECT v_invitation.chat_id, true, 'Can join room';
END;
$$;


ALTER FUNCTION "public"."can_user_join_room"("p_invite_code" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_activities"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    cleanup_count INTEGER;
BEGIN
    -- Delete expired activities
    DELETE FROM chat_activity WHERE expires_at < NOW();
    GET DIAGNOSTICS cleanup_count = ROW_COUNT;
    
    -- Also clean up very old activities (older than 24 hours)
    DELETE FROM chat_activity WHERE created_at < NOW() - INTERVAL '24 hours';
    
    RETURN cleanup_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_activities"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_orphaned_chunks"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM message_chunks
    WHERE parent_message_id NOT IN (SELECT id::TEXT FROM messages)
    AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_orphaned_chunks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_subscription_with_service_role"("p_user_id" "uuid", "p_subscription_plan_id" "uuid", "p_stripe_subscription_id" "text", "p_stripe_customer_id" "text", "p_status" "text", "p_current_period_start" timestamp with time zone, "p_current_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean DEFAULT false) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_subscription_id UUID;
BEGIN
    INSERT INTO user_subscriptions (
        user_id,
        subscription_plan_id,
        stripe_subscription_id,
        stripe_customer_id,
        status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
    ) VALUES (
        p_user_id,
        p_subscription_plan_id,
        p_stripe_subscription_id,
        p_stripe_customer_id,
        p_status,
        p_current_period_start,
        p_current_period_end,
        p_cancel_at_period_end
    ) RETURNING id INTO v_subscription_id;
    
    RETURN v_subscription_id;
END;
$$;


ALTER FUNCTION "public"."create_subscription_with_service_role"("p_user_id" "uuid", "p_subscription_plan_id" "uuid", "p_stripe_subscription_id" "text", "p_stripe_customer_id" "text", "p_status" "text", "p_current_period_start" timestamp with time zone, "p_current_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_subscription_with_service_role"("p_user_id" "uuid", "p_subscription_plan_id" "uuid", "p_stripe_subscription_id" "text", "p_stripe_customer_id" "text", "p_status" "text", "p_current_period_start" timestamp with time zone, "p_current_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean) IS 'Creates a subscription record with elevated privileges for webhook operations';



CREATE OR REPLACE FUNCTION "public"."debug_auth_status"() RETURNS TABLE("current_user_id" "uuid", "user_role" "text", "is_authenticated" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        auth.uid() as current_user_id,
        auth.role() as user_role,
        (auth.uid() IS NOT NULL) as is_authenticated;
END;
$$;


ALTER FUNCTION "public"."debug_auth_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_credits"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_current_balance INTEGER;
    v_new_balance INTEGER;
BEGIN
    -- Get current balance with lock
    SELECT balance INTO v_current_balance
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    -- Check if sufficient balance
    IF v_current_balance < p_amount THEN
        RETURN FALSE;
    END IF;
    
    -- Calculate new balance
    v_new_balance := v_current_balance - p_amount;
    
    -- Update balance
    UPDATE user_credits
    SET balance = v_new_balance,
        total_used = total_used + p_amount,
        last_usage_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Record transaction
    INSERT INTO credit_transactions (
        user_id, type, amount, balance_after,
        resource_type, resource_id, usage_description
    ) VALUES (
        p_user_id, 'usage', -p_amount, v_new_balance,
        p_resource_type, p_resource_id, p_description
    );
    
    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."deduct_credits"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_credits_partial"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_current_balance INTEGER;
    v_amount_to_deduct INTEGER;
    v_new_balance INTEGER;
BEGIN
    -- Get current balance with lock
    SELECT balance INTO v_current_balance
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    -- If no credits record exists, create one with 0 balance
    IF v_current_balance IS NULL THEN
        INSERT INTO user_credits (user_id, balance, total_purchased, total_used)
        VALUES (p_user_id, 0, 0, 0)
        ON CONFLICT (user_id) DO NOTHING;
        v_current_balance := 0;
    END IF;
    
    -- Determine amount to deduct (either requested amount or remaining balance)
    IF v_current_balance >= p_amount THEN
        v_amount_to_deduct := p_amount;
    ELSE
        -- Deduct whatever is available
        v_amount_to_deduct := v_current_balance;
    END IF;
    
    -- If nothing to deduct, return 0
    IF v_amount_to_deduct <= 0 THEN
        RETURN 0;
    END IF;
    
    -- Calculate new balance
    v_new_balance := v_current_balance - v_amount_to_deduct;
    
    -- Update balance
    UPDATE user_credits
    SET balance = v_new_balance,
        total_used = total_used + v_amount_to_deduct,
        last_usage_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Record transaction with actual amount deducted
    INSERT INTO credit_transactions (
        user_id, type, amount, balance_after,
        resource_type, resource_id, usage_description
    ) VALUES (
        p_user_id, 'usage', -v_amount_to_deduct, v_new_balance,
        p_resource_type, p_resource_id, 
        CASE 
            WHEN v_amount_to_deduct < p_amount THEN 
                p_description || ' (partial: ' || v_amount_to_deduct || ' of ' || p_amount || ' credits)'
            ELSE 
                p_description
        END
    );
    
    -- Return the actual amount deducted
    RETURN v_amount_to_deduct;
END;
$$;


ALTER FUNCTION "public"."deduct_credits_partial"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."deduct_credits_partial"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") IS 'Deducts credits from user balance with partial deduction support. Returns actual amount deducted.';



CREATE OR REPLACE FUNCTION "public"."emergency_save_message"("p_chat_id" "text", "p_content" "text", "p_role" "text" DEFAULT 'assistant'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    new_message_id UUID;
    valid_chat_id UUID;
BEGIN
    -- Try to convert chat_id to UUID
    BEGIN
        valid_chat_id := p_chat_id::UUID;
    EXCEPTION WHEN OTHERS THEN
        -- If conversion fails, generate a new UUID
        valid_chat_id := gen_random_uuid();
        RAISE LOG 'Invalid chat_id %, using new UUID %', p_chat_id, valid_chat_id;
    END;
    
    -- Ensure chat exists
    INSERT INTO chats (id, user_id, created_at, collaborative)
    VALUES (valid_chat_id, COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), NOW(), false)
    ON CONFLICT (id) DO NOTHING;
    
    -- Insert message
    INSERT INTO messages (chat_id, role, content, created_at)
    VALUES (valid_chat_id, p_role, COALESCE(p_content, ''), NOW())
    RETURNING id INTO new_message_id;
    
    RETURN new_message_id;
END;
$$;


ALTER FUNCTION "public"."emergency_save_message"("p_chat_id" "text", "p_content" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."end_machine_session"("p_session_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_machine_id UUID;
    v_started_at TIMESTAMPTZ;
BEGIN
    -- Get session details and end it
    UPDATE machine_sessions 
    SET ended_at = NOW()
    WHERE id = p_session_id 
    AND ended_at IS NULL
    RETURNING machine_id, started_at INTO v_machine_id, v_started_at;
    
    IF v_machine_id IS NOT NULL THEN
        -- Track usage
        PERFORM track_machine_usage(v_machine_id, v_started_at, NOW());
    END IF;
END;
$$;


ALTER FUNCTION "public"."end_machine_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_user_limits"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Insert default limits for new users
    INSERT INTO machine_limits (user_id, tier, max_machines, max_running_machines)
    VALUES (NEW.user_id, 'free', 1, 1)
    ON CONFLICT (user_id) DO NOTHING;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_user_limits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_invite_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
END;
$$;


ALTER FUNCTION "public"."generate_invite_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_share_id"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$;


ALTER FUNCTION "public"."generate_share_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_participants"("room_chat_id" "uuid") RETURNS TABLE("user_id" "uuid", "display_name" "text", "profile_image" "text", "role" "text", "last_active_at" timestamp with time zone, "is_typing" boolean, "is_online" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cp.user_id,
        u.display_name,
        u.profile_image,
        cp.role,
        cp.last_active_at,
        EXISTS(
            SELECT 1 FROM chat_activity ca 
            WHERE ca.chat_id = room_chat_id 
            AND ca.user_id = cp.user_id 
            AND ca.activity_type = 'typing'
            AND ca.expires_at > NOW()
        ) as is_typing,
        (cp.last_active_at > NOW() - INTERVAL '5 minutes') as is_online
    FROM chat_participants cp
    JOIN users u ON cp.user_id = u.id
    WHERE cp.chat_id = room_chat_id
    ORDER BY cp.role, cp.last_active_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_active_participants"("room_chat_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_command_stats"("p_machine_id" "uuid", "p_period_hours" integer DEFAULT 24) RETURNS TABLE("total_commands" integer, "successful_commands" integer, "failed_commands" integer, "avg_execution_time_ms" numeric, "most_used_command_type" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER AS total_commands,
        COUNT(*) FILTER (WHERE success = true)::INTEGER AS successful_commands,
        COUNT(*) FILTER (WHERE success = false)::INTEGER AS failed_commands,
        AVG(execution_time_ms)::DECIMAL AS avg_execution_time_ms,
        MODE() WITHIN GROUP (ORDER BY command_type) AS most_used_command_type
    FROM vm_command_history
    WHERE machine_id = p_machine_id
    AND executed_at >= NOW() - INTERVAL '1 hour' * p_period_hours;
END;
$$;


ALTER FUNCTION "public"."get_command_stats"("p_machine_id" "uuid", "p_period_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_user_credits"("p_user_id" "uuid") RETURNS TABLE("balance" integer, "total_purchased" integer, "total_used" integer, "last_purchase_at" timestamp with time zone, "last_usage_at" timestamp with time zone, "has_active_subscription" boolean, "subscription_tier" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Insert if not exists
    INSERT INTO user_credits (user_id, balance)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    
    -- Update subscription status
    UPDATE user_credits uc
    SET has_active_subscription = EXISTS(
        SELECT 1 FROM user_subscriptions
        WHERE user_id = p_user_id
        AND status = 'active'
    ),
    subscription_tier = (
        SELECT sp.tier
        FROM user_subscriptions us
        JOIN subscription_plans sp ON us.subscription_plan_id = sp.id
        WHERE us.user_id = p_user_id
        AND us.status = 'active'
        LIMIT 1
    )
    WHERE uc.user_id = p_user_id;
    
    -- Return the data
    RETURN QUERY
    SELECT 
        uc.balance,
        uc.total_purchased,
        uc.total_used,
        uc.last_purchase_at,
        uc.last_usage_at,
        uc.has_active_subscription,
        uc.subscription_tier
    FROM user_credits uc
    WHERE uc.user_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."get_or_create_user_credits"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_translation_accuracy"("p_user_id" "uuid", "p_days" integer DEFAULT 7) RETURNS TABLE("total_translations" integer, "executed_translations" integer, "avg_confidence" numeric, "success_rate" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    WITH translation_stats AS (
        SELECT 
            t.id,
            t.confidence_score,
            t.executed,
            CASE WHEN h.success IS NOT NULL THEN h.success ELSE NULL END AS execution_success
        FROM ai_command_translations t
        LEFT JOIN vm_command_history h ON h.session_id = t.session_id
            AND h.executed_at >= t.created_at
            AND h.executed_at <= t.created_at + INTERVAL '1 minute'
        WHERE t.user_id = p_user_id
        AND t.created_at >= CURRENT_DATE - INTERVAL '1 day' * p_days
    )
    SELECT 
        COUNT(*)::INTEGER AS total_translations,
        COUNT(*) FILTER (WHERE executed = true)::INTEGER AS executed_translations,
        AVG(confidence_score)::DECIMAL AS avg_confidence,
        (COUNT(*) FILTER (WHERE execution_success = true)::DECIMAL / 
         NULLIF(COUNT(*) FILTER (WHERE execution_success IS NOT NULL), 0))::DECIMAL AS success_rate
    FROM translation_stats;
END;
$$;


ALTER FUNCTION "public"."get_translation_accuracy"("p_user_id" "uuid", "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_balance"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT balance INTO v_balance
    FROM user_credits
    WHERE user_id = p_user_id;
    
    -- Return 0 if user not found
    RETURN COALESCE(v_balance, 0);
END;
$$;


ALTER FUNCTION "public"."get_user_balance"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_monthly_usage"("p_user_id" "uuid") RETURNS TABLE("total_hours" numeric, "total_cpu_hours" numeric, "total_estimated_cost" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(EXTRACT(EPOCH FROM (period_end - period_start)) / 3600), 0)::DECIMAL AS total_hours,
        COALESCE(SUM(cpu_seconds / 3600), 0)::DECIMAL AS total_cpu_hours,
        COALESCE(SUM(estimated_cost), 0)::DECIMAL AS total_estimated_cost
    FROM machine_usage
    WHERE user_id = p_user_id
    AND period_start >= date_trunc('month', CURRENT_DATE);
END;
$$;


ALTER FUNCTION "public"."get_user_monthly_usage"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_plan_limits"("p_user_id" "uuid") RETURNS TABLE("tier" "text", "max_machines" integer, "max_cpu_cores" integer, "max_memory_gb" integer, "max_storage_gb" integer, "max_hours_per_month" integer, "gpu_access" boolean, "allow_persistence" boolean, "allow_snapshots" boolean, "allow_custom_software" boolean)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_tier TEXT;
    v_max_machines INTEGER;
    v_max_cpu_cores INTEGER;
    v_max_memory_gb INTEGER;
    v_max_storage_gb INTEGER;
    v_max_hours_per_month INTEGER;
    v_gpu_access BOOLEAN;
    v_allow_persistence BOOLEAN;
    v_allow_snapshots BOOLEAN;
    v_allow_custom_software BOOLEAN;
BEGIN
    -- Try to get subscription plan limits
    SELECT
        sp.tier,
        sp.max_machines,
        sp.max_cpu_cores,
        sp.max_memory_gb,
        sp.max_storage_gb,
        sp.max_hours_per_month,
        sp.gpu_access,
        sp.allow_persistence,
        sp.allow_snapshots,
        sp.allow_custom_software
    INTO
        v_tier,
        v_max_machines,
        v_max_cpu_cores,
        v_max_memory_gb,
        v_max_storage_gb,
        v_max_hours_per_month,
        v_gpu_access,
        v_allow_persistence,
        v_allow_snapshots,
        v_allow_custom_software
    FROM user_subscriptions us
    JOIN subscription_plans sp ON us.subscription_plan_id = sp.id
    WHERE us.user_id = p_user_id
        AND us.status IN ('active', 'trialing')
        AND (us.current_period_end IS NULL OR us.current_period_end > NOW())
    LIMIT 1;

    -- If no subscription found, return free tier defaults
    IF v_tier IS NULL THEN
        v_tier := 'free';
        v_max_machines := 1;
        v_max_cpu_cores := 1;
        v_max_memory_gb := 3;
        v_max_storage_gb := 10;
        v_max_hours_per_month := 20;
        v_gpu_access := false;
        v_allow_persistence := false;
        v_allow_snapshots := false;
        v_allow_custom_software := false;
    END IF;

    RETURN QUERY
    SELECT
        v_tier,
        v_max_machines,
        v_max_cpu_cores,
        v_max_memory_gb,
        v_max_storage_gb,
        v_max_hours_per_month,
        v_gpu_access,
        v_allow_persistence,
        v_allow_snapshots,
        v_allow_custom_software;
END;
$$;


ALTER FUNCTION "public"."get_user_plan_limits"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_plan_limits"("p_user_id" "uuid") IS 'Get the virtual machine resource limits for a user based on their subscription plan';



CREATE OR REPLACE FUNCTION "public"."grant_subscription_credits"("p_user_id" "uuid", "p_subscription_id" "uuid", "p_credits" integer, "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_invoice_id" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_current_balance INTEGER;
    v_new_balance INTEGER;
BEGIN
    -- Check if credits already granted for this period
    IF EXISTS (
        SELECT 1 FROM subscription_credit_grants
        WHERE subscription_id = p_subscription_id
        AND billing_period_start = p_period_start
    ) THEN
        RAISE NOTICE 'Credits already granted for this period';
        RETURN;
    END IF;
    
    -- Get current balance
    SELECT balance INTO v_current_balance
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    IF v_current_balance IS NULL THEN
        -- Create user credits if not exists
        INSERT INTO user_credits (user_id, balance)
        VALUES (p_user_id, p_credits);
        v_new_balance := p_credits;
    ELSE
        -- Add credits to existing balance
        v_new_balance := v_current_balance + p_credits;
        
        UPDATE user_credits
        SET balance = v_new_balance,
            updated_at = NOW()
        WHERE user_id = p_user_id;
    END IF;
    
    -- Record the grant
    INSERT INTO subscription_credit_grants (
        user_id, subscription_id, credits_granted,
        billing_period_start, billing_period_end, stripe_invoice_id
    ) VALUES (
        p_user_id, p_subscription_id, p_credits,
        p_period_start, p_period_end, p_invoice_id
    );
    
    -- Record in transactions
    INSERT INTO credit_transactions (
        user_id, type, amount, balance_after,
        subscription_id, usage_description
    ) VALUES (
        p_user_id, 'bonus', p_credits, v_new_balance,
        p_subscription_id, 'Monthly subscription credits'
    );
    
    -- Mark subscription as having granted credits this period
    UPDATE user_subscriptions
    SET credits_granted_this_period = TRUE,
        updated_at = NOW()
    WHERE id = p_subscription_id;
END;
$$;


ALTER FUNCTION "public"."grant_subscription_credits"("p_user_id" "uuid", "p_subscription_id" "uuid", "p_credits" integer, "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_invoice_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_public_chat_share_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.public = true AND NEW.public_share_id IS NULL THEN
    NEW.public_share_id := generate_share_id();
  ELSIF NEW.public = false AND OLD.public = true THEN
    NEW.public_share_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_public_chat_share_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_active_subscription"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_has_subscription BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 
        FROM user_subscriptions 
        WHERE user_id = p_user_id 
        AND status = 'active'
        AND (current_period_end IS NULL OR current_period_end > NOW())
    ) INTO v_has_subscription;
    
    RETURN v_has_subscription;
END;
$$;


ALTER FUNCTION "public"."has_active_subscription"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."initialize_user_credits"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    INSERT INTO user_credits (user_id, balance)
    VALUES (NEW.id, 100)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
EXCEPTION
    WHEN foreign_key_violation THEN
        -- Ignore if user doesn't exist
        RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."initialize_user_credits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."initialize_user_machine_access"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Create default limits for user if not exists
    INSERT INTO machine_limits (
        user_id, 
        tier, 
        max_machines, 
        max_running_machines,
        max_cpu_cores,
        max_memory_gb,
        max_storage_gb,
        max_hours_per_month,
        max_sessions_per_day
    ) VALUES (
        p_user_id,
        'free',
        1,
        1,
        2,
        4,
        20,
        20,
        10
    ) ON CONFLICT (user_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."initialize_user_machine_access"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_assistant_message_bypass_rls"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb" DEFAULT NULL::"jsonb", "p_message_group_id" "text" DEFAULT NULL::"text", "p_model" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    new_message_id UUID;
    v_chat_exists BOOLEAN;
BEGIN
    -- Validate chat_id is not null and is valid UUID
    IF p_chat_id IS NULL THEN
        RAISE EXCEPTION 'Chat ID cannot be null';
    END IF;
    
    -- Check if chat exists (without RLS)
    SELECT EXISTS(
        SELECT 1 FROM chats WHERE id = p_chat_id
    ) INTO v_chat_exists;
    
    IF NOT v_chat_exists THEN
        -- Try to create a minimal chat if it doesn't exist
        INSERT INTO chats (id, user_id, created_at, collaborative)
        VALUES (p_chat_id, COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), NOW(), false)
        ON CONFLICT (id) DO NOTHING;
    END IF;
    
    -- Generate new UUID for message
    new_message_id := gen_random_uuid();
    
    -- Insert message directly without any RLS checks
    INSERT INTO messages (
        id,
        chat_id, 
        role, 
        content, 
        parts, 
        model, 
        created_at,
        message_group_id
    )
    VALUES (
        new_message_id,
        p_chat_id, 
        'assistant', 
        COALESCE(p_content, ''), 
        p_parts, 
        p_model, 
        NOW(),
        p_message_group_id
    );
    
    RETURN new_message_id;
    
EXCEPTION
    WHEN invalid_text_representation THEN
        -- Handle UUID parse errors
        RAISE LOG 'Invalid UUID provided: %, using new UUID', p_chat_id;
        RETURN NULL;
    WHEN OTHERS THEN
        RAISE LOG 'Error in bypass function: % - %', SQLSTATE, SQLERRM;
        RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."insert_assistant_message_bypass_rls"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb", "p_message_group_id" "text", "p_model" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_message_simple"("p_chat_id" "uuid", "p_role" "text", "p_content" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    new_message_id UUID;
BEGIN
    -- Direct insert without any checks (for emergency use)
    INSERT INTO messages (chat_id, role, content, created_at)
    VALUES (p_chat_id, p_role, p_content, NOW())
    RETURNING id INTO new_message_id;
    
    RETURN new_message_id;
END;
$$;


ALTER FUNCTION "public"."insert_message_simple"("p_chat_id" "uuid", "p_role" "text", "p_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_user_participant_in_chat"("user_uuid" "uuid", "chat_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM chat_participants 
        WHERE user_id = user_uuid 
        AND chat_id = chat_uuid
    );
EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."is_user_participant_in_chat"("user_uuid" "uuid", "chat_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_user_participant_in_collaborative_chat"("chat_uuid" "uuid", "user_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM chats c
        JOIN chat_participants cp ON c.id = cp.chat_id
        WHERE c.id = chat_uuid 
        AND c.collaborative = true
        AND cp.user_id = user_uuid
    );
EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."is_user_participant_in_collaborative_chat"("chat_uuid" "uuid", "user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_collaborative_room"("room_invite_code" "text", "joining_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    room_chat_id UUID;
    room_record RECORD;
    participant_count INTEGER;
BEGIN
    -- Find the chat by invite code
    SELECT id, max_participants, collaborative, public INTO room_record
    FROM chats 
    WHERE invite_code = room_invite_code AND collaborative = true;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code');
    END IF;
    
    room_chat_id := room_record.id;
    
    -- Check if user is already a participant
    IF EXISTS(SELECT 1 FROM chat_participants WHERE chat_id = room_chat_id AND user_id = joining_user_id) THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already a participant', 'chat_id', room_chat_id);
    END IF;
    
    -- Check room capacity
    SELECT COUNT(*) INTO participant_count FROM chat_participants WHERE chat_id = room_chat_id;
    
    IF participant_count >= room_record.max_participants THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room is full');
    END IF;
    
    -- Add user as participant
    INSERT INTO chat_participants (chat_id, user_id, role)
    VALUES (room_chat_id, joining_user_id, 'participant');
    
    -- Mark any invitations as used
    UPDATE chat_invitations 
    SET used_at = NOW(), used_by = joining_user_id
    WHERE chat_id = room_chat_id 
    AND (invited_user_id = joining_user_id OR invited_user_id IS NULL)
    AND invite_code = room_invite_code
    AND used_at IS NULL;
    
    RETURN jsonb_build_object('success', true, 'message', 'Successfully joined room', 'chat_id', room_chat_id);
END;
$$;


ALTER FUNCTION "public"."join_collaborative_room"("room_invite_code" "text", "joining_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_assistant_message_direct"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb" DEFAULT NULL::"jsonb", "p_model" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    new_message_id UUID;
BEGIN
    -- Direct insert, no UUID validation for message_group_id
    INSERT INTO messages (
        chat_id,
        role,
        content,
        parts,
        model,
        created_at
    ) VALUES (
        p_chat_id,
        'assistant',
        p_content,
        p_parts,
        p_model,
        NOW()
    ) RETURNING id INTO new_message_id;
    
    RETURN new_message_id;
END;
$$;


ALTER FUNCTION "public"."save_assistant_message_direct"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb", "p_model" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_collaborative_room_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Update last_seen_at for the user who sent the message
    UPDATE chat_participants
    SET last_seen_at = CURRENT_TIMESTAMP
    WHERE chat_id = NEW.chat_id AND user_id = NEW.user_id;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_collaborative_room_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."test_message_fetch"("p_chat_id" "uuid") RETURNS TABLE("can_see_chat" boolean, "is_owner" boolean, "is_participant" boolean, "message_count" integer, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_can_see_chat BOOLEAN;
    v_is_owner BOOLEAN;
    v_is_participant BOOLEAN;
    v_message_count INTEGER;
    v_error_message TEXT;
BEGIN
    -- Check if user can see the chat
    SELECT EXISTS(
        SELECT 1 FROM chats 
        WHERE id = p_chat_id 
        AND (
            user_id = auth.uid() 
            OR collaborative = true
            OR public = true
        )
    ) INTO v_can_see_chat;
    
    -- Check if user owns the chat
    SELECT EXISTS(
        SELECT 1 FROM chats 
        WHERE id = p_chat_id 
        AND user_id = auth.uid()
    ) INTO v_is_owner;
    
    -- Check if user is a participant
    SELECT EXISTS(
        SELECT 1 FROM chat_participants 
        WHERE chat_id = p_chat_id 
        AND user_id = auth.uid()
    ) INTO v_is_participant;
    
    -- Try to count messages
    BEGIN
        SELECT COUNT(*) 
        FROM messages 
        WHERE chat_id = p_chat_id 
        INTO v_message_count;
        
        v_error_message := 'Success';
    EXCEPTION WHEN OTHERS THEN
        v_message_count := 0;
        v_error_message := SQLERRM;
    END;
    
    RETURN QUERY SELECT 
        v_can_see_chat,
        v_is_owner,
        v_is_participant,
        v_message_count,
        v_error_message;
END;
$$;


ALTER FUNCTION "public"."test_message_fetch"("p_chat_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."track_machine_usage"("p_machine_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
    v_cpu_cores DECIMAL;
    v_memory_gb DECIMAL;
    v_duration_seconds DECIMAL;
    v_usage_id UUID;
BEGIN
    -- Get machine details
    SELECT user_id, cpu_cores, memory_gb 
    INTO v_user_id, v_cpu_cores, v_memory_gb
    FROM user_machines 
    WHERE id = p_machine_id;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Machine not found';
    END IF;
    
    -- Calculate duration
    v_duration_seconds := EXTRACT(EPOCH FROM (p_end_time - p_start_time));
    
    -- Insert usage record
    INSERT INTO machine_usage (
        user_id, 
        machine_id, 
        period_start, 
        period_end,
        cpu_seconds,
        memory_gb_seconds,
        estimated_cost
    ) VALUES (
        v_user_id,
        p_machine_id,
        p_start_time,
        p_end_time,
        v_cpu_cores * v_duration_seconds,
        v_memory_gb * v_duration_seconds,
        -- Basic cost calculation (adjust as needed)
        (v_cpu_cores * 0.0000125 + v_memory_gb * 0.0000125) * v_duration_seconds
    ) RETURNING id INTO v_usage_id;
    
    RETURN v_usage_id;
END;
$$;


ALTER FUNCTION "public"."track_machine_usage"("p_machine_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_collaborative_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  sync_user_id UUID;
  chat_owner_id UUID;
BEGIN
  -- Log all message inserts for debugging
  RAISE NOTICE 'TRIGGER: Message % (role: %, chat: %, user_id: %)', 
    NEW.id, NEW.role, NEW.chat_id, NEW.user_id;

  -- Only trigger for collaborative rooms
  IF EXISTS (SELECT 1 FROM chats WHERE id = NEW.chat_id AND collaborative = true) THEN
    RAISE NOTICE 'TRIGGER: Processing collaborative room %', NEW.chat_id;
    
    -- Handle user_id properly
    IF NEW.user_id IS NOT NULL THEN
      sync_user_id := NEW.user_id;
    ELSE
      -- For assistant messages without user_id, use the chat owner's ID
      SELECT user_id INTO chat_owner_id FROM chats WHERE id = NEW.chat_id;
      sync_user_id := COALESCE(chat_owner_id, '00000000-0000-0000-0000-000000000000'::UUID);
    END IF;
    
    RAISE NOTICE 'TRIGGER: Using sync_user_id: %', sync_user_id;
    
    -- Insert sync notification
    INSERT INTO chat_activity (
      chat_id,
      user_id,
      activity_type,
      metadata,
      expires_at
    ) VALUES (
      NEW.chat_id,
      sync_user_id,
      'message_saved',
      jsonb_build_object(
        'message_id', NEW.id,
        'message_role', NEW.role,
        'sync_trigger', true,
        'timestamp', NOW(),
        'trigger_source', 'database_fixed'
      ),
      NOW() + INTERVAL '15 seconds'
    )
    ON CONFLICT (chat_id, user_id, activity_type) DO UPDATE SET
      metadata = jsonb_build_object(
        'message_id', NEW.id,
        'message_role', NEW.role,
        'sync_trigger', true,
        'timestamp', NOW(),
        'trigger_source', 'database_fixed',
        'update_count', COALESCE((EXCLUDED.metadata->>'update_count')::int, 0) + 1
      ),
      expires_at = NOW() + INTERVAL '15 seconds',
      created_at = NOW();
      
    RAISE NOTICE 'TRIGGER: Sync activity processed for room %', NEW.chat_id;
  ELSE
    RAISE NOTICE 'TRIGGER: Skipping non-collaborative room %', NEW.chat_id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_collaborative_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_collaborative_sync_simple"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Only trigger for collaborative rooms
  IF EXISTS (SELECT 1 FROM chats WHERE id = NEW.chat_id AND collaborative = true) THEN
    -- Use a simple approach that bypasses potential RLS issues
    PERFORM pg_notify(
      'collaborative_sync',
      json_build_object(
        'chat_id', NEW.chat_id,
        'message_id', NEW.id,
        'role', NEW.role,
        'action', 'message_saved'
      )::text
    );
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_collaborative_sync_simple"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_credits_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_credits_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_machine_last_active"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE user_machines 
    SET last_active_at = NOW() 
    WHERE id = NEW.machine_id;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_machine_last_active"() OWNER TO "postgres";


-- See supabase/migrations/011_unify_tier_vocabulary.sql for full documentation.
-- Single writer for tier state.  Updates user_subscriptions, user_credits,
-- and machine_limits.tier atomically.  Called by Stripe webhook.
CREATE OR REPLACE FUNCTION "public"."update_subscription_status"(
    "p_stripe_subscription_id" "text",
    "p_status"                  "text",
    "p_period_start"            timestamp with time zone DEFAULT NULL,
    "p_period_end"              timestamp with time zone DEFAULT NULL,
    "p_cancel_at_period_end"    boolean                  DEFAULT NULL,
    "p_subscription_plan_id"    "uuid"                   DEFAULT NULL
) RETURNS TABLE (
    "user_id"       "uuid",
    "resolved_tier" "text",
    "is_paid"       boolean
)
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
    v_user_id   uuid;
    v_plan_tier text;
    v_new_tier  text;
    v_is_paid   boolean;
BEGIN
    v_is_paid := p_status IN ('active','trialing','past_due');

    UPDATE public.user_subscriptions
    SET    status               = p_status,
           current_period_start = COALESCE(p_period_start, current_period_start),
           current_period_end   = COALESCE(p_period_end,   current_period_end),
           cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
           subscription_plan_id = COALESCE(p_subscription_plan_id, subscription_plan_id),
           canceled_at          = CASE WHEN p_status = 'canceled' THEN COALESCE(canceled_at, NOW()) ELSE canceled_at END,
           updated_at           = NOW()
    WHERE  stripe_subscription_id = p_stripe_subscription_id
    RETURNING user_subscriptions.user_id INTO v_user_id;

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'update_subscription_status: subscription % not found', p_stripe_subscription_id;
        RETURN;
    END IF;

    IF v_is_paid THEN
        SELECT sp.tier INTO v_plan_tier
        FROM   public.user_subscriptions us
        LEFT JOIN public.subscription_plans sp ON sp.id = us.subscription_plan_id
        WHERE  us.stripe_subscription_id = p_stripe_subscription_id;

        IF v_plan_tier IS NULL THEN
            RAISE WARNING 'update_subscription_status: no plan resolved for sub %; tier unchanged', p_stripe_subscription_id;
            RETURN QUERY SELECT v_user_id, NULL::text, v_is_paid;
            RETURN;
        END IF;
        v_new_tier := v_plan_tier;
    ELSE
        v_new_tier := 'free';
    END IF;

    UPDATE public.user_credits
    SET    has_active_subscription = v_is_paid,
           subscription_tier       = CASE WHEN v_is_paid THEN v_new_tier ELSE NULL END,
           updated_at              = NOW()
    WHERE  user_credits.user_id = v_user_id;

    IF NOT FOUND THEN
        INSERT INTO public.user_credits (user_id, balance, has_active_subscription, subscription_tier)
        VALUES (v_user_id, 0, v_is_paid, CASE WHEN v_is_paid THEN v_new_tier ELSE NULL END)
        ON CONFLICT (user_id) DO UPDATE
        SET    has_active_subscription = EXCLUDED.has_active_subscription,
               subscription_tier       = EXCLUDED.subscription_tier,
               updated_at              = NOW();
    END IF;

    INSERT INTO public.machine_limits (user_id, tier)
    VALUES (v_user_id, v_new_tier)
    ON CONFLICT (user_id) DO UPDATE
    SET    tier       = EXCLUDED.tier,
           updated_at = NOW();

    RETURN QUERY SELECT v_user_id, v_new_tier, v_is_paid;
END;
$$;


ALTER FUNCTION "public"."update_subscription_status"("p_stripe_subscription_id" "text", "p_status" "text", "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean, "p_subscription_plan_id" "uuid") OWNER TO "postgres";

-- Reconciliation helper.  Re-derives a user's tier from current
-- user_subscriptions state and projects it through to user_credits and
-- machine_limits.  Used by customer.subscription.deleted and any cleanup job
-- that needs to reset tier from scratch.
CREATE OR REPLACE FUNCTION "public"."sync_user_tier"("p_user_id" "uuid")
RETURNS "text"
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
    v_tier text;
BEGIN
    SELECT sp.tier INTO v_tier
    FROM   public.user_subscriptions us
    JOIN   public.subscription_plans sp ON sp.id = us.subscription_plan_id
    WHERE  us.user_id = p_user_id
      AND  us.status  IN ('active','trialing','past_due')
    ORDER BY us.current_period_end DESC NULLS LAST,
             us.created_at         DESC
    LIMIT 1;

    v_tier := COALESCE(v_tier, 'free');

    UPDATE public.user_credits
    SET    has_active_subscription = (v_tier <> 'free'),
           subscription_tier       = CASE WHEN v_tier <> 'free' THEN v_tier ELSE NULL END,
           updated_at              = NOW()
    WHERE  user_id = p_user_id;

    INSERT INTO public.machine_limits (user_id, tier)
    VALUES (p_user_id, v_tier)
    ON CONFLICT (user_id) DO UPDATE
    SET    tier       = EXCLUDED.tier,
           updated_at = NOW();

    RETURN v_tier;
END;
$$;


ALTER FUNCTION "public"."sync_user_tier"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_preferences_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_preferences_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_websocket_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE vm_websocket_sessions
    SET 
        last_activity_at = NOW(),
        messages_received = messages_received + 1
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_websocket_activity"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."chat_activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "activity_type" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval) NOT NULL,
    CONSTRAINT "chat_activity_activity_type_check" CHECK (("activity_type" = ANY (ARRAY['typing'::"text", 'viewing'::"text", 'joined'::"text", 'left'::"text", 'message_saved'::"text", 'message_deleted'::"text"])))
);


ALTER TABLE "public"."chat_activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_attachments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_name" "text",
    "file_type" "text",
    "file_size" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chat_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "invite_code" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "max_uses" integer DEFAULT 1,
    "uses" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."chat_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'participant'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" timestamp with time zone,
    CONSTRAINT "chat_participants_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'moderator'::"text", 'participant'::"text"])))
);


ALTER TABLE "public"."chat_participants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."chat_participants"."last_seen_at" IS 'v';



CREATE TABLE IF NOT EXISTS "public"."chats" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "title" "text",
    "model" "text",
    "system_prompt" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "public" boolean DEFAULT false NOT NULL,
    "collaborative" boolean DEFAULT false,
    "max_participants" integer DEFAULT 10,
    "invite_code" "text",
    "room_settings" "jsonb" DEFAULT '{}'::"jsonb",
    "public_share_id" "text",
    "is_collaborative" boolean DEFAULT false,
    "collaborative_settings" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."chats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "credits" integer NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text",
    "stripe_product_id" "text",
    "stripe_price_id" "text",
    "description" "text",
    "popular" boolean DEFAULT false,
    "discount_percentage" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."credit_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_rates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource_type" "text" NOT NULL,
    "credits_per_unit" integer NOT NULL,
    "unit_type" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."credit_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" integer NOT NULL,
    "balance_after" integer NOT NULL,
    "stripe_payment_intent_id" "text",
    "stripe_checkout_session_id" "text",
    "currency" "text" DEFAULT 'usd'::"text",
    "price_paid" numeric(10,2),
    "resource_type" "text",
    "resource_id" "uuid",
    "usage_description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "subscription_id" "uuid",
    CONSTRAINT "credit_transactions_type_check" CHECK (("type" = ANY (ARRAY['purchase'::"text", 'usage'::"text", 'refund'::"text", 'bonus'::"text", 'expired'::"text", 'subscription_grant'::"text", 'subscription_renewal'::"text", 'subscription_reactivation'::"text"])))
);


ALTER TABLE "public"."credit_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."machine_ai_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "machine_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "action_target" "text",
    "action_parameters" "jsonb" DEFAULT '{}'::"jsonb",
    "executed_at" timestamp with time zone DEFAULT "now"(),
    "execution_time_ms" integer,
    "success" boolean NOT NULL,
    "error_message" "text",
    "screenshot_before" "text",
    "screenshot_after" "text",
    "ai_reasoning" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "screenshot_base64" "text",
    CONSTRAINT "machine_ai_actions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'executing'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."machine_ai_actions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."machine_ai_actions"."screenshot_base64" IS 'Base64 encoded screenshot data URL (data:image/png;base64,...)';



CREATE TABLE IF NOT EXISTS "public"."machine_limits" (
    "user_id" "uuid" NOT NULL,
    "tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "max_machines" integer DEFAULT 1 NOT NULL,
    "max_running_machines" integer DEFAULT 1 NOT NULL,
    "max_cpu_cores" numeric DEFAULT 2 NOT NULL,
    "max_memory_gb" numeric DEFAULT 4 NOT NULL,
    "max_storage_gb" integer DEFAULT 20 NOT NULL,
    "gpu_access" boolean DEFAULT false,
    "max_hours_per_month" integer DEFAULT 20 NOT NULL,
    "max_sessions_per_day" integer DEFAULT 10 NOT NULL,
    "allow_internet_access" boolean DEFAULT false,
    "allowed_domains" "text"[] DEFAULT '{}'::"text"[],
    "allow_persistence" boolean DEFAULT false,
    "allow_snapshots" boolean DEFAULT false,
    "allow_custom_software" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "machine_limits_tier_check" CHECK (("tier" = ANY (ARRAY['free'::"text", 'lite'::"text", 'starter'::"text", 'professional'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."machine_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."machine_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "machine_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "session_type" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"(),
    "ended_at" timestamp with time zone,
    "duration_seconds" integer,
    "actions_performed" "jsonb" DEFAULT '[]'::"jsonb",
    "screenshots_captured" integer DEFAULT 0,
    "commands_executed" integer DEFAULT 0,
    "errors_encountered" integer DEFAULT 0,
    "ai_model" "text",
    "ai_objective" "text",
    "ai_completion_status" "text",
    CONSTRAINT "machine_sessions_ai_completion_status_check" CHECK (("ai_completion_status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "machine_sessions_session_type_check" CHECK (("session_type" = ANY (ARRAY['ai_controlled'::"text", 'user_controlled'::"text", 'mixed'::"text"])))
);


ALTER TABLE "public"."machine_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."machine_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "machine_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "snapshot_name" "text" NOT NULL,
    "snapshot_type" "text",
    "storage_location" "text" NOT NULL,
    "size_gb" numeric NOT NULL,
    "os_state" "jsonb" DEFAULT '{}'::"jsonb",
    "installed_software" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    CONSTRAINT "machine_snapshots_snapshot_type_check" CHECK (("snapshot_type" = ANY (ARRAY['manual'::"text", 'auto'::"text", 'pre_shutdown'::"text"])))
);


ALTER TABLE "public"."machine_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."machine_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "machine_id" "uuid" NOT NULL,
    "period_start" timestamp with time zone NOT NULL,
    "period_end" timestamp with time zone NOT NULL,
    "cpu_seconds" numeric DEFAULT 0 NOT NULL,
    "memory_gb_seconds" numeric DEFAULT 0 NOT NULL,
    "storage_gb_hours" numeric DEFAULT 0 NOT NULL,
    "network_gb_transferred" numeric DEFAULT 0 NOT NULL,
    "estimated_cost" numeric(10,4) DEFAULT 0
);


ALTER TABLE "public"."machine_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_chunks" (
    "id" "text" NOT NULL,
    "parent_message_id" "text" NOT NULL,
    "chunk_index" integer NOT NULL,
    "total_chunks" integer NOT NULL,
    "content" "text" NOT NULL,
    "is_compressed" boolean DEFAULT false,
    "original_size" bigint,
    "compressed_size" bigint,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."message_chunks" OWNER TO "postgres";


COMMENT ON TABLE "public"."message_chunks" IS 'Stores large message content in chunks for reliable storage and retrieval';



COMMENT ON COLUMN "public"."message_chunks"."parent_message_id" IS 'References the original message ID';



COMMENT ON COLUMN "public"."message_chunks"."chunk_index" IS 'Zero-based index of this chunk';



COMMENT ON COLUMN "public"."message_chunks"."total_chunks" IS 'Total number of chunks for the parent message';



COMMENT ON COLUMN "public"."message_chunks"."is_compressed" IS 'Whether the chunk content is gzip compressed';



COMMENT ON COLUMN "public"."message_chunks"."original_size" IS 'Size in bytes before compression';



COMMENT ON COLUMN "public"."message_chunks"."compressed_size" IS 'Size in bytes after compression';



CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" integer NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "content" "text",
    "role" "text" NOT NULL,
    "experimental_attachments" "jsonb",
    "parts" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "message_group_id" "text",
    "model" "text",
    "is_chunked" boolean DEFAULT false,
    "is_compressed" boolean DEFAULT false,
    "truncated" boolean DEFAULT false,
    CONSTRAINT "messages_role_check" CHECK (("role" = ANY (ARRAY['system'::"text", 'user'::"text", 'assistant'::"text", 'data'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."messages_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."messages_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."messages_id_seq" OWNED BY "public"."messages"."id";



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text" NOT NULL,
    "email" "text",
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stripe_customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_events" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "processed" boolean DEFAULT false,
    "data" "jsonb" NOT NULL,
    "processed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stripe_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_credit_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "subscription_id" "uuid" NOT NULL,
    "credits_granted" integer NOT NULL,
    "billing_period_start" timestamp with time zone NOT NULL,
    "billing_period_end" timestamp with time zone NOT NULL,
    "stripe_invoice_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subscription_credit_grants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stripe_product_id" "text",
    "stripe_price_id" "text",
    "name" "text" NOT NULL,
    "tier" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'usd'::"text",
    "interval" "text" DEFAULT 'month'::"text",
    "monthly_credits" integer NOT NULL,
    "credits_description" "text",
    "features" "jsonb" DEFAULT '[]'::"jsonb",
    "description" "text",
    "popular" boolean DEFAULT false,
    "sort_order" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "max_machines" integer DEFAULT 1,
    "max_cpu_cores" integer DEFAULT 2,
    "max_memory_gb" integer DEFAULT 4,
    "max_storage_gb" integer DEFAULT 10,
    "max_hours_per_month" integer DEFAULT 20,
    "gpu_access" boolean DEFAULT false,
    "allow_persistence" boolean DEFAULT false,
    "allow_snapshots" boolean DEFAULT false,
    "allow_custom_software" boolean DEFAULT false,
    CONSTRAINT "subscription_plans_interval_check" CHECK (("interval" = ANY (ARRAY['month'::"text", 'year'::"text"]))),
    CONSTRAINT "subscription_plans_tier_check" CHECK (("tier" = ANY (ARRAY['lite'::"text", 'starter'::"text", 'professional'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."subscription_plans" OWNER TO "postgres";


COMMENT ON COLUMN "public"."subscription_plans"."max_machines" IS 'Maximum number of virtual machines allowed for this plan';



COMMENT ON COLUMN "public"."subscription_plans"."max_cpu_cores" IS 'Maximum CPU cores per machine for this plan';



COMMENT ON COLUMN "public"."subscription_plans"."max_memory_gb" IS 'Maximum memory (GB) per machine for this plan';



COMMENT ON COLUMN "public"."subscription_plans"."max_storage_gb" IS 'Maximum storage (GB) per machine for this plan';



COMMENT ON COLUMN "public"."subscription_plans"."max_hours_per_month" IS 'Maximum VM hours per month for this plan';



COMMENT ON COLUMN "public"."subscription_plans"."gpu_access" IS 'Whether GPU access is enabled for this plan';



COMMENT ON COLUMN "public"."subscription_plans"."allow_persistence" IS 'Whether persistent storage is allowed for this plan';



COMMENT ON COLUMN "public"."subscription_plans"."allow_snapshots" IS 'Whether VM snapshots are allowed for this plan';



COMMENT ON COLUMN "public"."subscription_plans"."allow_custom_software" IS 'Whether custom software installation is allowed for this plan';



CREATE TABLE IF NOT EXISTS "public"."user_credits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "balance" integer DEFAULT 0 NOT NULL,
    "total_purchased" integer DEFAULT 0 NOT NULL,
    "total_used" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_purchase_at" timestamp with time zone,
    "last_usage_at" timestamp with time zone,
    "has_active_subscription" boolean DEFAULT false,
    "subscription_tier" "text"
);


ALTER TABLE "public"."user_credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_keys" (
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "encrypted_key" "text" NOT NULL,
    "iv" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_machines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "container_name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "status" "text" DEFAULT 'creating'::"text" NOT NULL,
    "status_message" "text",
    "azure_resource_group" "text" NOT NULL,
    "azure_container_group" "text" NOT NULL,
    "azure_resource_id" "text",
    "azure_location" "text" DEFAULT 'eastus'::"text",
    "public_ip_address" "text",
    "vnc_password" "text" NOT NULL,
    "vnc_port" integer DEFAULT 5901,
    "websocket_port" integer DEFAULT 6080,
    "ssh_port" integer,
    "cpu_cores" numeric DEFAULT 1 NOT NULL,
    "memory_gb" numeric DEFAULT 2 NOT NULL,
    "storage_gb" integer DEFAULT 10 NOT NULL,
    "gpu_enabled" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "started_at" timestamp with time zone,
    "last_active_at" timestamp with time zone DEFAULT "now"(),
    "auto_shutdown_at" timestamp with time zone,
    "auto_shutdown_minutes" integer DEFAULT 30,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "user_machines_status_check" CHECK (("status" = ANY (ARRAY['creating'::"text", 'starting'::"text", 'running'::"text", 'stopping'::"text", 'stopped'::"text", 'error'::"text", 'deleting'::"text"])))
);


ALTER TABLE "public"."user_machines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "layout" "text" DEFAULT 'fullscreen'::"text",
    "prompt_suggestions" boolean DEFAULT true,
    "show_tool_invocations" boolean DEFAULT true,
    "show_conversation_previews" boolean DEFAULT true,
    "multi_model_enabled" boolean DEFAULT false,
    "hidden_models" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "subscription_plan_id" "uuid",
    "stripe_subscription_id" "text",
    "stripe_customer_id" "text",
    "status" "text" NOT NULL,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false,
    "canceled_at" timestamp with time zone,
    "trial_start" timestamp with time zone,
    "trial_end" timestamp with time zone,
    "credits_granted_this_period" boolean DEFAULT false,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'canceled'::"text", 'incomplete'::"text", 'incomplete_expired'::"text", 'past_due'::"text", 'trialing'::"text", 'unpaid'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."user_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "anonymous" boolean,
    "daily_message_count" integer,
    "daily_reset" timestamp with time zone,
    "display_name" "text",
    "favorite_models" "text"[],
    "message_count" integer,
    "premium" boolean,
    "profile_image" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_active_at" timestamp with time zone DEFAULT "now"(),
    "daily_pro_message_count" integer,
    "daily_pro_reset" timestamp with time zone,
    "system_prompt" "text"
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."messages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."chat_activity"
    ADD CONSTRAINT "chat_activity_chat_id_user_id_activity_type_key" UNIQUE ("chat_id", "user_id", "activity_type");



ALTER TABLE ONLY "public"."chat_activity"
    ADD CONSTRAINT "chat_activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_attachments"
    ADD CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_invitations"
    ADD CONSTRAINT "chat_invitations_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."chat_invitations"
    ADD CONSTRAINT "chat_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_participants"
    ADD CONSTRAINT "chat_participants_chat_id_user_id_key" UNIQUE ("chat_id", "user_id");



ALTER TABLE ONLY "public"."chat_participants"
    ADD CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chats"
    ADD CONSTRAINT "chats_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."chats"
    ADD CONSTRAINT "chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chats"
    ADD CONSTRAINT "chats_public_share_id_key" UNIQUE ("public_share_id");



ALTER TABLE ONLY "public"."credit_packages"
    ADD CONSTRAINT "credit_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_rates"
    ADD CONSTRAINT "credit_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_rates"
    ADD CONSTRAINT "credit_rates_resource_type_key" UNIQUE ("resource_type");



ALTER TABLE ONLY "public"."credit_transactions"
    ADD CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."machine_ai_actions"
    ADD CONSTRAINT "machine_ai_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."machine_limits"
    ADD CONSTRAINT "machine_limits_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."machine_sessions"
    ADD CONSTRAINT "machine_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."machine_snapshots"
    ADD CONSTRAINT "machine_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."machine_usage"
    ADD CONSTRAINT "machine_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_chunks"
    ADD CONSTRAINT "message_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_customers"
    ADD CONSTRAINT "stripe_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_customers"
    ADD CONSTRAINT "stripe_customers_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."stripe_customers"
    ADD CONSTRAINT "stripe_customers_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."stripe_events"
    ADD CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_credit_grants"
    ADD CONSTRAINT "subscription_credit_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_stripe_price_id_key" UNIQUE ("stripe_price_id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_stripe_product_id_key" UNIQUE ("stripe_product_id");



ALTER TABLE ONLY "public"."message_chunks"
    ADD CONSTRAINT "unique_chunk" UNIQUE ("parent_message_id", "chunk_index");



ALTER TABLE ONLY "public"."user_credits"
    ADD CONSTRAINT "user_credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_credits"
    ADD CONSTRAINT "user_credits_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_keys"
    ADD CONSTRAINT "user_keys_pkey" PRIMARY KEY ("user_id", "provider");



ALTER TABLE ONLY "public"."user_machines"
    ADD CONSTRAINT "user_machines_container_name_key" UNIQUE ("container_name");



ALTER TABLE ONLY "public"."user_machines"
    ADD CONSTRAINT "user_machines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_actions_session_time" ON "public"."machine_ai_actions" USING "btree" ("session_id", "executed_at" DESC);



CREATE INDEX "idx_chat_activity_chat_id" ON "public"."chat_activity" USING "btree" ("chat_id");



CREATE INDEX "idx_chat_activity_chat_user_type" ON "public"."chat_activity" USING "btree" ("chat_id", "user_id", "activity_type");



CREATE INDEX "idx_chat_activity_expires" ON "public"."chat_activity" USING "btree" ("expires_at");



CREATE INDEX "idx_chat_activity_type" ON "public"."chat_activity" USING "btree" ("activity_type");



CREATE INDEX "idx_chat_invitations_chat_id" ON "public"."chat_invitations" USING "btree" ("chat_id");



CREATE INDEX "idx_chat_invitations_invite_code" ON "public"."chat_invitations" USING "btree" ("invite_code");



CREATE INDEX "idx_chat_participants_chat_id" ON "public"."chat_participants" USING "btree" ("chat_id");



CREATE INDEX "idx_chat_participants_user_id" ON "public"."chat_participants" USING "btree" ("user_id");



CREATE INDEX "idx_chats_collaborative" ON "public"."chats" USING "btree" ("collaborative") WHERE ("collaborative" = true);



CREATE INDEX "idx_chats_collaborative_id" ON "public"."chats" USING "btree" ("collaborative", "id") WHERE ("collaborative" = true);



CREATE INDEX "idx_chats_invite_code" ON "public"."chats" USING "btree" ("invite_code") WHERE ("invite_code" IS NOT NULL);



CREATE INDEX "idx_chats_is_collaborative" ON "public"."chats" USING "btree" ("is_collaborative");



CREATE INDEX "idx_chats_public_share_id" ON "public"."chats" USING "btree" ("public_share_id") WHERE ("public_share_id" IS NOT NULL);



CREATE INDEX "idx_credit_transactions_created_at" ON "public"."credit_transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_credit_transactions_user_id" ON "public"."credit_transactions" USING "btree" ("user_id");



CREATE INDEX "idx_machine_ai_actions_executed_at" ON "public"."machine_ai_actions" USING "btree" ("executed_at");



CREATE INDEX "idx_machine_ai_actions_machine_id" ON "public"."machine_ai_actions" USING "btree" ("machine_id");



CREATE INDEX "idx_machine_ai_actions_session_id" ON "public"."machine_ai_actions" USING "btree" ("session_id");



CREATE INDEX "idx_machine_ai_actions_status" ON "public"."machine_ai_actions" USING "btree" ("session_id", "status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_machine_sessions_machine_id" ON "public"."machine_sessions" USING "btree" ("machine_id");



CREATE INDEX "idx_machine_sessions_started_at" ON "public"."machine_sessions" USING "btree" ("started_at");



CREATE INDEX "idx_machine_sessions_user_id" ON "public"."machine_sessions" USING "btree" ("user_id");



CREATE INDEX "idx_machine_sessions_user_machine" ON "public"."machine_sessions" USING "btree" ("user_id", "machine_id");



CREATE INDEX "idx_machine_snapshots_created_at" ON "public"."machine_snapshots" USING "btree" ("created_at");



CREATE INDEX "idx_machine_snapshots_machine_id" ON "public"."machine_snapshots" USING "btree" ("machine_id");



CREATE INDEX "idx_machine_usage_machine_id" ON "public"."machine_usage" USING "btree" ("machine_id");



CREATE INDEX "idx_machine_usage_period" ON "public"."machine_usage" USING "btree" ("period_start", "period_end");



CREATE INDEX "idx_machine_usage_user_id" ON "public"."machine_usage" USING "btree" ("user_id");



CREATE INDEX "idx_machines_user_status" ON "public"."user_machines" USING "btree" ("user_id", "status");



CREATE INDEX "idx_message_chunks_parent" ON "public"."message_chunks" USING "btree" ("parent_message_id");



CREATE INDEX "idx_message_chunks_parent_index" ON "public"."message_chunks" USING "btree" ("parent_message_id", "chunk_index");



CREATE INDEX "idx_messages_chat_id_created_at" ON "public"."messages" USING "btree" ("chat_id", "created_at" DESC);



CREATE INDEX "idx_messages_chat_id_role" ON "public"."messages" USING "btree" ("chat_id", "role");



CREATE INDEX "idx_messages_chunked" ON "public"."messages" USING "btree" ("is_chunked") WHERE ("is_chunked" = true);



CREATE INDEX "idx_messages_collaborative_sync" ON "public"."messages" USING "btree" ("chat_id", "created_at" DESC);



CREATE INDEX "idx_sessions_machine_active" ON "public"."machine_sessions" USING "btree" ("machine_id", "ended_at") WHERE ("ended_at" IS NULL);



CREATE INDEX "idx_stripe_customers_stripe_id" ON "public"."stripe_customers" USING "btree" ("stripe_customer_id");



CREATE INDEX "idx_stripe_events_processed" ON "public"."stripe_events" USING "btree" ("processed");



CREATE INDEX "idx_subscription_credit_grants_period" ON "public"."subscription_credit_grants" USING "btree" ("billing_period_start", "billing_period_end");



CREATE INDEX "idx_subscription_credit_grants_subscription_id" ON "public"."subscription_credit_grants" USING "btree" ("subscription_id");



CREATE INDEX "idx_subscription_credit_grants_user_id" ON "public"."subscription_credit_grants" USING "btree" ("user_id");



CREATE INDEX "idx_subscription_plans_active" ON "public"."subscription_plans" USING "btree" ("active");



CREATE INDEX "idx_subscription_plans_tier" ON "public"."subscription_plans" USING "btree" ("tier");



CREATE INDEX "idx_usage_user_period" ON "public"."machine_usage" USING "btree" ("user_id", "period_start" DESC);



CREATE INDEX "idx_user_credits_user_id" ON "public"."user_credits" USING "btree" ("user_id");



CREATE INDEX "idx_user_machines_container_name" ON "public"."user_machines" USING "btree" ("container_name");



CREATE INDEX "idx_user_machines_status" ON "public"."user_machines" USING "btree" ("status");



CREATE INDEX "idx_user_machines_user_id" ON "public"."user_machines" USING "btree" ("user_id");



CREATE INDEX "idx_user_subscriptions_period_end" ON "public"."user_subscriptions" USING "btree" ("current_period_end");



CREATE INDEX "idx_user_subscriptions_status" ON "public"."user_subscriptions" USING "btree" ("status");



CREATE INDEX "idx_user_subscriptions_stripe_id" ON "public"."user_subscriptions" USING "btree" ("stripe_subscription_id");



CREATE INDEX "idx_user_subscriptions_user_id" ON "public"."user_subscriptions" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "handle_public_chat_share_id_trigger" BEFORE UPDATE ON "public"."chats" FOR EACH ROW EXECUTE FUNCTION "public"."handle_public_chat_share_id"();



CREATE OR REPLACE TRIGGER "trigger_add_chat_owner_as_participant" AFTER INSERT OR UPDATE ON "public"."chats" FOR EACH ROW EXECUTE FUNCTION "public"."add_chat_owner_as_participant"();



CREATE OR REPLACE TRIGGER "trigger_auto_generate_invite_code" BEFORE INSERT OR UPDATE ON "public"."chats" FOR EACH ROW EXECUTE FUNCTION "public"."auto_generate_invite_code"();



CREATE OR REPLACE TRIGGER "trigger_calculate_duration" BEFORE UPDATE ON "public"."machine_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."calculate_session_duration"();



CREATE OR REPLACE TRIGGER "trigger_collaborative_sync" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."sync_collaborative_room_activity"();



CREATE OR REPLACE TRIGGER "trigger_ensure_limits" BEFORE INSERT ON "public"."user_machines" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_user_limits"();



CREATE OR REPLACE TRIGGER "trigger_initialize_credits" AFTER INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."initialize_user_credits"();



CREATE OR REPLACE TRIGGER "trigger_message_sync_notification" AFTER INSERT OR UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_collaborative_sync"();



CREATE OR REPLACE TRIGGER "trigger_update_machine_activity" AFTER INSERT ON "public"."machine_ai_actions" FOR EACH ROW EXECUTE FUNCTION "public"."update_machine_last_active"();



CREATE OR REPLACE TRIGGER "update_chat_invitations_updated_at" BEFORE UPDATE ON "public"."chat_invitations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_chat_participants_updated_at" BEFORE UPDATE ON "public"."chat_participants" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_preferences_timestamp" BEFORE UPDATE ON "public"."user_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_preferences_updated_at"();



ALTER TABLE ONLY "public"."chat_activity"
    ADD CONSTRAINT "chat_activity_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_activity"
    ADD CONSTRAINT "chat_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_invitations"
    ADD CONSTRAINT "chat_invitations_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_invitations"
    ADD CONSTRAINT "chat_invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_participants"
    ADD CONSTRAINT "chat_participants_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_participants"
    ADD CONSTRAINT "chat_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chats"
    ADD CONSTRAINT "chats_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chats"
    ADD CONSTRAINT "chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_transactions"
    ADD CONSTRAINT "credit_transactions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_subscriptions"("id");



ALTER TABLE ONLY "public"."credit_transactions"
    ADD CONSTRAINT "credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_attachments"
    ADD CONSTRAINT "fk_chat" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_attachments"
    ADD CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_ai_actions"
    ADD CONSTRAINT "machine_ai_actions_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "public"."user_machines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_ai_actions"
    ADD CONSTRAINT "machine_ai_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."machine_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_limits"
    ADD CONSTRAINT "machine_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_sessions"
    ADD CONSTRAINT "machine_sessions_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "public"."user_machines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_sessions"
    ADD CONSTRAINT "machine_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_snapshots"
    ADD CONSTRAINT "machine_snapshots_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "public"."user_machines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_snapshots"
    ADD CONSTRAINT "machine_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_usage"
    ADD CONSTRAINT "machine_usage_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "public"."user_machines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."machine_usage"
    ADD CONSTRAINT "machine_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stripe_customers"
    ADD CONSTRAINT "stripe_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_credit_grants"
    ADD CONSTRAINT "subscription_credit_grants_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_subscriptions"("id");



ALTER TABLE ONLY "public"."subscription_credit_grants"
    ADD CONSTRAINT "subscription_credit_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_credits"
    ADD CONSTRAINT "user_credits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_keys"
    ADD CONSTRAINT "user_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_machines"
    ADD CONSTRAINT "user_machines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_subscription_plan_id_fkey" FOREIGN KEY ("subscription_plan_id") REFERENCES "public"."subscription_plans"("id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can view active packages" ON "public"."credit_packages" FOR SELECT USING (("active" = true));



CREATE POLICY "Anyone can view active subscription plans" ON "public"."subscription_plans" FOR SELECT USING (("active" = true));



CREATE POLICY "Anyone can view attachments from public chats" ON "public"."chat_attachments" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "chat_attachments"."chat_id") AND ("chats"."public" = true)))));



CREATE POLICY "Anyone can view credit rates" ON "public"."credit_rates" FOR SELECT USING (true);



CREATE POLICY "Anyone can view messages from public chats" ON "public"."messages" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "messages"."chat_id") AND ("chats"."public" = true)))));



CREATE POLICY "Anyone can view public chats" ON "public"."chats" FOR SELECT TO "authenticated", "anon" USING (("public" = true));



CREATE POLICY "Creators can delete their invitations" ON "public"."chat_invitations" FOR DELETE TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "Creators can update their invitations" ON "public"."chat_invitations" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "Owners and moderators can create invitations" ON "public"."chat_invitations" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."chat_participants"
  WHERE (("chat_participants"."chat_id" = "chat_invitations"."chat_id") AND ("chat_participants"."user_id" = "auth"."uid"()) AND ("chat_participants"."role" = ANY (ARRAY['owner'::"text", 'moderator'::"text"])))))));



CREATE POLICY "Owners and moderators can update participants" ON "public"."chat_participants" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."chat_participants" "cp"
  WHERE (("cp"."chat_id" = "chat_participants"."chat_id") AND ("cp"."user_id" = "auth"."uid"()) AND ("cp"."role" = ANY (ARRAY['owner'::"text", 'moderator'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."chat_participants" "cp"
  WHERE (("cp"."chat_id" = "chat_participants"."chat_id") AND ("cp"."user_id" = "auth"."uid"()) AND ("cp"."role" = ANY (ARRAY['owner'::"text", 'moderator'::"text"]))))));



CREATE POLICY "Service role bypass" ON "public"."user_subscriptions" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role bypass for credit grants" ON "public"."subscription_credit_grants" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role bypass for stripe events" ON "public"."stripe_events" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage all chunks" ON "public"."message_chunks" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "Service role can manage all credits" ON "public"."user_credits" USING (true);



CREATE POLICY "Service role can manage all stripe customers" ON "public"."stripe_customers" USING (true);



CREATE POLICY "Service role can manage all stripe events" ON "public"."stripe_events" USING (true);



CREATE POLICY "Service role can manage all transactions" ON "public"."credit_transactions" USING (true);



CREATE POLICY "Service role has full access to limits" ON "public"."machine_limits" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "System can create user limits on trigger" ON "public"."machine_limits" FOR INSERT WITH CHECK (true);



CREATE POLICY "System can insert AI actions" ON "public"."machine_ai_actions" FOR INSERT WITH CHECK (true);



CREATE POLICY "System can insert usage records" ON "public"."machine_usage" FOR INSERT WITH CHECK (true);



CREATE POLICY "System can update usage records" ON "public"."machine_usage" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Users can create feedback" ON "public"."feedback" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create own machines" ON "public"."user_machines" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create own sessions" ON "public"."machine_sessions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create own snapshots" ON "public"."machine_snapshots" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create sessions for their machines" ON "public"."machine_sessions" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."user_machines"
  WHERE (("user_machines"."id" = "machine_sessions"."machine_id") AND ("user_machines"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can create their own API keys" ON "public"."user_keys" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own chats" ON "public"."chats" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own machines" ON "public"."user_machines" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can create their own preferences" ON "public"."user_preferences" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create their own projects" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete attachments from their own chats" ON "public"."chat_attachments" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "chat_attachments"."chat_id") AND ("chats"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete messages from their own chats" ON "public"."messages" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "messages"."chat_id") AND ("chats"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete own machines" ON "public"."user_machines" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own snapshots" ON "public"."machine_snapshots" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own API keys" ON "public"."user_keys" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own chats" ON "public"."chats" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own machines" ON "public"."user_machines" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own preferences" ON "public"."user_preferences" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own projects" ON "public"."projects" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert messages into their own chats" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "messages"."chat_id") AND ("chats"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert own credit grants" ON "public"."subscription_credit_grants" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own credits" ON "public"."user_credits" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own subscriptions" ON "public"."user_subscriptions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert themselves as participants" ON "public"."chat_participants" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."chat_participants" "chat_participants_1"
  WHERE (("chat_participants_1"."chat_id" = "chat_participants_1"."chat_id") AND ("chat_participants_1"."user_id" = "auth"."uid"()) AND ("chat_participants_1"."role" = ANY (ARRAY['owner'::"text", 'moderator'::"text"])))))));



CREATE POLICY "Users can remove themselves or owners can remove others" ON "public"."chat_participants" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."chat_participants" "cp"
  WHERE (("cp"."chat_id" = "chat_participants"."chat_id") AND ("cp"."user_id" = "auth"."uid"()) AND ("cp"."role" = 'owner'::"text"))))));



CREATE POLICY "Users can update own credits" ON "public"."user_credits" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own limits" ON "public"."machine_limits" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own machines" ON "public"."user_machines" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own sessions" ON "public"."machine_sessions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own snapshots" ON "public"."machine_snapshots" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own subscriptions" ON "public"."user_subscriptions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own API keys" ON "public"."user_keys" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own chats" ON "public"."chats" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own machines" ON "public"."user_machines" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update their own messages" ON "public"."messages" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "messages"."chat_id") AND ("chats"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "messages"."chat_id") AND ("chats"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own preferences" ON "public"."user_preferences" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profile" ON "public"."users" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their own projects" ON "public"."projects" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own sessions" ON "public"."machine_sessions" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can upload attachments to their own chats" ON "public"."chat_attachments" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "chat_attachments"."chat_id") AND ("chats"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view actions for own sessions" ON "public"."machine_ai_actions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."machine_sessions"
  WHERE (("machine_sessions"."id" = "machine_ai_actions"."session_id") AND ("machine_sessions"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view attachments from their own chats" ON "public"."chat_attachments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "chat_attachments"."chat_id") AND ("chats"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view chunks for their messages" ON "public"."message_chunks" FOR SELECT USING (("parent_message_id" IN ( SELECT ("m"."id")::"text" AS "id"
   FROM ("public"."messages" "m"
     JOIN "public"."chats" "c" ON (("m"."chat_id" = "c"."id")))
  WHERE ("c"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view invitations for chats they're part of" ON "public"."chat_invitations" FOR SELECT TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."chat_participants"
  WHERE (("chat_participants"."chat_id" = "chat_invitations"."chat_id") AND ("chat_participants"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view messages from their own chats" ON "public"."messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "messages"."chat_id") AND ("chats"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own credit grants" ON "public"."subscription_credit_grants" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own credits" ON "public"."user_credits" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own limits" ON "public"."machine_limits" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own machines" ON "public"."user_machines" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own sessions" ON "public"."machine_sessions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own snapshots" ON "public"."machine_snapshots" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own stripe customer" ON "public"."stripe_customers" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own subscriptions" ON "public"."user_subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own transactions" ON "public"."credit_transactions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own usage" ON "public"."machine_usage" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view participants in chats they're part of" ON "public"."chat_participants" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."chat_participants" "cp2"
  WHERE (("cp2"."chat_id" = "chat_participants"."chat_id") AND ("cp2"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view their own API keys" ON "public"."user_keys" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own chats" ON "public"."chats" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own feedback" ON "public"."feedback" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own machines" ON "public"."user_machines" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own preferences" ON "public"."user_preferences" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own profile" ON "public"."users" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own projects" ON "public"."projects" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own sessions" ON "public"."machine_sessions" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "activity_open" ON "public"."chat_activity" USING (("auth"."uid"() IS NOT NULL)) WITH CHECK (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."chat_activity" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chats_owner_all" ON "public"."chats" USING ((("auth"."uid"() = "user_id") OR ("collaborative" = true))) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."credit_packages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_rates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."machine_ai_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."machine_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."machine_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."machine_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."machine_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_direct_access" ON "public"."messages" USING ((EXISTS ( SELECT 1
   FROM "public"."chats"
  WHERE (("chats"."id" = "messages"."chat_id") AND (("chats"."user_id" = "auth"."uid"()) OR ("chats"."collaborative" = true)))))) WITH CHECK (true);



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_bypass_activity" ON "public"."chat_activity" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_bypass_chats" ON "public"."chats" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_bypass_messages" ON "public"."messages" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."stripe_customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_credit_grants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_credits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_machines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."add_chat_owner_as_participant"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_chat_owner_as_participant"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_chat_owner_as_participant"() TO "service_role";



GRANT ALL ON FUNCTION "public"."add_credits"("p_user_id" "uuid", "p_amount" integer, "p_type" "text", "p_stripe_payment_id" "text", "p_price_paid" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."add_credits"("p_user_id" "uuid", "p_amount" integer, "p_type" "text", "p_stripe_payment_id" "text", "p_price_paid" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_credits"("p_user_id" "uuid", "p_amount" integer, "p_type" "text", "p_stripe_payment_id" "text", "p_price_paid" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_generate_invite_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_generate_invite_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_generate_invite_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_session_duration"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_session_duration"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_session_duration"() TO "service_role";



GRANT ALL ON FUNCTION "public"."can_user_create_machine"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_user_create_machine"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_user_create_machine"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_user_join_room"("p_invite_code" "text", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_user_join_room"("p_invite_code" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_user_join_room"("p_invite_code" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_activities"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_activities"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_activities"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_orphaned_chunks"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_orphaned_chunks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_orphaned_chunks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_subscription_with_service_role"("p_user_id" "uuid", "p_subscription_plan_id" "uuid", "p_stripe_subscription_id" "text", "p_stripe_customer_id" "text", "p_status" "text", "p_current_period_start" timestamp with time zone, "p_current_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."create_subscription_with_service_role"("p_user_id" "uuid", "p_subscription_plan_id" "uuid", "p_stripe_subscription_id" "text", "p_stripe_customer_id" "text", "p_status" "text", "p_current_period_start" timestamp with time zone, "p_current_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_subscription_with_service_role"("p_user_id" "uuid", "p_subscription_plan_id" "uuid", "p_stripe_subscription_id" "text", "p_stripe_customer_id" "text", "p_status" "text", "p_current_period_start" timestamp with time zone, "p_current_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."debug_auth_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."debug_auth_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."debug_auth_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."deduct_credits"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."deduct_credits"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."deduct_credits"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."deduct_credits_partial"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."deduct_credits_partial"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."deduct_credits_partial"("p_user_id" "uuid", "p_amount" integer, "p_resource_type" "text", "p_resource_id" "uuid", "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."emergency_save_message"("p_chat_id" "text", "p_content" "text", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."emergency_save_message"("p_chat_id" "text", "p_content" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."emergency_save_message"("p_chat_id" "text", "p_content" "text", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."end_machine_session"("p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."end_machine_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."end_machine_session"("p_session_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_user_limits"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_user_limits"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_user_limits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_invite_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_invite_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_invite_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_share_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_share_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_share_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_active_participants"("room_chat_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_active_participants"("room_chat_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_participants"("room_chat_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_command_stats"("p_machine_id" "uuid", "p_period_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_command_stats"("p_machine_id" "uuid", "p_period_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_command_stats"("p_machine_id" "uuid", "p_period_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_create_user_credits"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_user_credits"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_user_credits"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_translation_accuracy"("p_user_id" "uuid", "p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_translation_accuracy"("p_user_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_translation_accuracy"("p_user_id" "uuid", "p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_balance"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_balance"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_balance"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_monthly_usage"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_monthly_usage"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_monthly_usage"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_plan_limits"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_plan_limits"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_plan_limits"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."grant_subscription_credits"("p_user_id" "uuid", "p_subscription_id" "uuid", "p_credits" integer, "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_invoice_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."grant_subscription_credits"("p_user_id" "uuid", "p_subscription_id" "uuid", "p_credits" integer, "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_invoice_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."grant_subscription_credits"("p_user_id" "uuid", "p_subscription_id" "uuid", "p_credits" integer, "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_invoice_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_public_chat_share_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_public_chat_share_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_public_chat_share_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_active_subscription"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_active_subscription"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_active_subscription"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."initialize_user_credits"() TO "anon";
GRANT ALL ON FUNCTION "public"."initialize_user_credits"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."initialize_user_credits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."initialize_user_machine_access"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."initialize_user_machine_access"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."initialize_user_machine_access"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_assistant_message_bypass_rls"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb", "p_message_group_id" "text", "p_model" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_assistant_message_bypass_rls"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb", "p_message_group_id" "text", "p_model" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_assistant_message_bypass_rls"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb", "p_message_group_id" "text", "p_model" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_message_simple"("p_chat_id" "uuid", "p_role" "text", "p_content" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_message_simple"("p_chat_id" "uuid", "p_role" "text", "p_content" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_message_simple"("p_chat_id" "uuid", "p_role" "text", "p_content" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_user_participant_in_chat"("user_uuid" "uuid", "chat_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_user_participant_in_chat"("user_uuid" "uuid", "chat_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_user_participant_in_chat"("user_uuid" "uuid", "chat_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_user_participant_in_collaborative_chat"("chat_uuid" "uuid", "user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_user_participant_in_collaborative_chat"("chat_uuid" "uuid", "user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_user_participant_in_collaborative_chat"("chat_uuid" "uuid", "user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."join_collaborative_room"("room_invite_code" "text", "joining_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."join_collaborative_room"("room_invite_code" "text", "joining_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_collaborative_room"("room_invite_code" "text", "joining_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_assistant_message_direct"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb", "p_model" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."save_assistant_message_direct"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb", "p_model" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_assistant_message_direct"("p_chat_id" "uuid", "p_content" "text", "p_parts" "jsonb", "p_model" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_collaborative_room_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_collaborative_room_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_collaborative_room_activity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."test_message_fetch"("p_chat_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."test_message_fetch"("p_chat_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_message_fetch"("p_chat_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."track_machine_usage"("p_machine_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."track_machine_usage"("p_machine_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."track_machine_usage"("p_machine_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_collaborative_sync"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_collaborative_sync"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_collaborative_sync"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_collaborative_sync_simple"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_collaborative_sync_simple"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_collaborative_sync_simple"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_credits_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_credits_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_credits_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_machine_last_active"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_machine_last_active"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_machine_last_active"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_subscription_status"("p_stripe_subscription_id" "text", "p_status" "text", "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."update_subscription_status"("p_stripe_subscription_id" "text", "p_status" "text", "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_subscription_status"("p_stripe_subscription_id" "text", "p_status" "text", "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_preferences_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_preferences_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_preferences_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_websocket_activity"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_websocket_activity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_websocket_activity"() TO "service_role";


















GRANT ALL ON TABLE "public"."chat_activity" TO "anon";
GRANT ALL ON TABLE "public"."chat_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_activity" TO "service_role";



GRANT ALL ON TABLE "public"."chat_attachments" TO "anon";
GRANT ALL ON TABLE "public"."chat_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."chat_invitations" TO "anon";
GRANT ALL ON TABLE "public"."chat_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."chat_participants" TO "anon";
GRANT ALL ON TABLE "public"."chat_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_participants" TO "service_role";



GRANT ALL ON TABLE "public"."chats" TO "anon";
GRANT ALL ON TABLE "public"."chats" TO "authenticated";
GRANT ALL ON TABLE "public"."chats" TO "service_role";



GRANT ALL ON TABLE "public"."credit_packages" TO "anon";
GRANT ALL ON TABLE "public"."credit_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_packages" TO "service_role";



GRANT ALL ON TABLE "public"."credit_rates" TO "anon";
GRANT ALL ON TABLE "public"."credit_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_rates" TO "service_role";



GRANT ALL ON TABLE "public"."credit_transactions" TO "anon";
GRANT ALL ON TABLE "public"."credit_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."machine_ai_actions" TO "anon";
GRANT ALL ON TABLE "public"."machine_ai_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."machine_ai_actions" TO "service_role";



GRANT ALL ON TABLE "public"."machine_limits" TO "anon";
GRANT ALL ON TABLE "public"."machine_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."machine_limits" TO "service_role";



GRANT ALL ON TABLE "public"."machine_sessions" TO "anon";
GRANT ALL ON TABLE "public"."machine_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."machine_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."machine_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."machine_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."machine_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."machine_usage" TO "anon";
GRANT ALL ON TABLE "public"."machine_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."machine_usage" TO "service_role";



GRANT ALL ON TABLE "public"."message_chunks" TO "anon";
GRANT ALL ON TABLE "public"."message_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."message_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_customers" TO "anon";
GRANT ALL ON TABLE "public"."stripe_customers" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_customers" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_events" TO "anon";
GRANT ALL ON TABLE "public"."stripe_events" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_events" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_credit_grants" TO "anon";
GRANT ALL ON TABLE "public"."subscription_credit_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_credit_grants" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plans" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plans" TO "service_role";



GRANT ALL ON TABLE "public"."user_credits" TO "anon";
GRANT ALL ON TABLE "public"."user_credits" TO "authenticated";
GRANT ALL ON TABLE "public"."user_credits" TO "service_role";



GRANT ALL ON TABLE "public"."user_keys" TO "anon";
GRANT ALL ON TABLE "public"."user_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."user_keys" TO "service_role";



GRANT ALL ON TABLE "public"."user_machines" TO "anon";
GRANT ALL ON TABLE "public"."user_machines" TO "authenticated";
GRANT ALL ON TABLE "public"."user_machines" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."user_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;
