# Responsible Use Guidelines

Open Computer Use provides powerful AI agents with the ability to browse the web, execute commands, and control applications autonomously. With great power comes great responsibility.

## Table of Contents

- [Core Principles](#core-principles)
- [Acceptable Use](#acceptable-use)
- [Prohibited Activities](#prohibited-activities)
- [Security Best Practices](#security-best-practices)
- [Privacy & Data Protection](#privacy--data-protection)
- [Legal Compliance](#legal-compliance)
- [Rate Limiting & Resource Usage](#rate-limiting--resource-usage)
- [Reporting Misuse](#reporting-misuse)

---

## Core Principles

### 1. Respect & Responsibility

Use Open Computer Use in a manner that:
- Respects the rights and property of others
- Complies with applicable laws and regulations
- Follows website terms of service and robots.txt files
- Minimizes harm to systems and services
- Maintains ethical standards

### 2. Transparency

Be transparent about:
- Using AI agents for automation
- The purpose of your automated activities
- Your identity when required by services
- Data collection and usage

### 3. Accountability

You are responsible for:
- All actions performed by your AI agents
- Ensuring compliance with this guide
- Monitoring agent behavior
- Addressing any issues or violations promptly

---

## Acceptable Use

### Research & Learning

**Appropriate:**
- Gathering public information for research
- Learning web automation and AI techniques
- Educational projects and experimentation
- Academic studies with proper methodology

**Example:**
```
"Search for the top 10 AI research papers from 2024 and summarize their key findings"
```

### Task Automation

**Appropriate:**
- Automating repetitive personal tasks
- Testing your own applications
- Data backup and organization
- Personal productivity workflows

**Example:**
```
"Check my email drafts folder and organize them by date"
```

### Development & Testing

**Appropriate:**
- Testing web applications you own
- Quality assurance automation
- Performance benchmarking (with permission)
- CI/CD pipeline integration

**Example:**
```
"Test the checkout flow on my staging website and report any errors"
```

### Content Creation

**Appropriate:**
- Creating tutorials and documentation
- Generating workflow demonstrations
- Capturing screenshots for guides
- Producing educational content

**Example:**
```
"Create a step-by-step tutorial with screenshots for setting up a Python environment"
```

---

## Prohibited Activities

### 1. Unauthorized Access

**Never use Open Computer Use to:**
- Access systems without authorization
- Bypass authentication or security measures
- Exploit vulnerabilities in websites or applications
- Gain unauthorized access to private data
- Circumvent paywalls or subscription services

**Examples of violations:**
```
❌ "Find a way to access this paid content for free"
❌ "Try to log into this account without credentials"
❌ "Exploit this vulnerability to gain admin access"
```

### 2. Harmful Activities

**Never use Open Computer Use to:**
- Launch denial-of-service attacks
- Distribute malware or viruses
- Conduct phishing campaigns
- Create spam or unsolicited messages
- Engage in cyberbullying or harassment

**Examples of violations:**
```
❌ "Send this message to 1000 email addresses"
❌ "Flood this website with requests to slow it down"
❌ "Download and install this suspicious software"
```

### 3. Fraud & Deception

**Never use Open Computer Use to:**
- Create fake accounts or identities
- Manipulate reviews, ratings, or votes
- Engage in price manipulation
- Conduct financial fraud
- Impersonate others

**Examples of violations:**
```
❌ "Create 100 fake accounts to boost my ratings"
❌ "Post fake positive reviews for my product"
❌ "Manipulate prices by automated buying/selling"
```

### 4. Intellectual Property Violations

**Never use Open Computer Use to:**
- Pirate copyrighted content
- Scrape content without permission
- Violate software licenses
- Steal trade secrets or proprietary information

**Examples of violations:**
```
❌ "Download all movies from this streaming site"
❌ "Copy all content from competitor websites"
❌ "Extract proprietary pricing algorithms"
```

### 5. Data Privacy Violations

**Never use Open Computer Use to:**
- Harvest personal information without consent
- Violate GDPR, CCPA, or other privacy laws
- Scrape sensitive personal data
- Process data without legal basis
- Store credentials or payment information

**Examples of violations:**
```
❌ "Collect email addresses from social media profiles"
❌ "Extract personal information from public records"
❌ "Store credit card details from forms"
```

---

## Security Best Practices

### 1. Credential Management

**DO:**
- Use environment variables for API keys
- Enable encryption (ENCRYPTION_KEY)
- Rotate credentials regularly
- Use least-privilege access
- Store credentials securely

**DON'T:**
- Hardcode passwords or API keys
- Share credentials with others
- Use the same password across services
- Store credentials in VM environments
- Log sensitive information

### 2. VM Isolation

**DO:**
- Use isolated Docker containers
- Limit network access when possible
- Monitor resource usage
- Clean up containers regularly
- Use ephemeral environments

**DON'T:**
- Run untrusted code without isolation
- Share VMs across users
- Persist sensitive data in VMs
- Disable security features
- Allow unlimited resource usage

### 3. Code Security

**DO:**
- Review generated commands before execution
- Validate user inputs
- Use parameterized queries
- Sanitize file paths
- Implement rate limiting

**DON'T:**
- Execute arbitrary code without review
- Trust user input blindly
- Disable security warnings
- Skip input validation
- Ignore security alerts

---

## Privacy & Data Protection

### Data Collection

**What we collect:**
- Usage metrics for improvement
- Error logs for debugging
- Performance data for optimization

**What we DON'T collect:**
- API keys or credentials (encrypted locally)
- Personal data from your agents
- Content of your conversations (unless explicitly shared)
- Browser history or private information

### User Responsibilities

**You must:**
- Comply with GDPR, CCPA, and applicable privacy laws
- Obtain consent before collecting personal data
- Provide privacy notices to data subjects
- Implement data protection measures
- Honor data deletion requests

### Data Retention

- **User accounts**: Retained while active, deleted on request
- **Chat history**: Stored in your Supabase instance
- **VM data**: Ephemeral, deleted after session ends
- **Logs**: Retained for 30 days for debugging

---

## Legal Compliance

### Website Terms of Service

**Always:**
- Review and comply with website ToS before automation
- Check robots.txt files and respect directives
- Honor rate limits and crawl-delay settings
- Identify your bot in user-agent strings
- Stop if requested by site owners

**Example robots.txt compliance:**
```
# Respect these directives
User-agent: *
Disallow: /private/
Crawl-delay: 10
```

### Copyright & Fair Use

- Only scrape content where legally permitted
- Respect copyright notices
- Apply fair use principles appropriately
- Provide attribution when required
- Obtain licenses for commercial use

### Anti-Spam Laws

- Comply with CAN-SPAM Act (USA)
- Follow GDPR marketing rules (EU)
- Respect opt-out requests immediately
- Include accurate sender information
- Provide unsubscribe mechanisms

---

## Rate Limiting & Resource Usage

### Respectful Automation

**Best practices:**
- Implement delays between requests (e.g., 1-5 seconds)
- Respect HTTP 429 (Too Many Requests) responses
- Use caching to minimize redundant requests
- Batch operations when possible
- Monitor bandwidth usage

**Example:**
```python
# Good: Respect rate limits
await asyncio.sleep(2)  # 2 second delay between requests

# Bad: Aggressive scraping
for i in range(1000):
    scrape_page(i)  # No delays
```

### Resource Quotas

**Self-imposed limits:**
- Max 60 requests per minute per domain
- Max 1000 pages per session
- Max 2GB memory per VM
- Max 4 CPU cores per VM
- Max 2 hour session duration

---

## Reporting Misuse

### If You Observe Misuse

Please report to: **prateek@coasty.ai**

Include:
- Description of the violation
- Date and time observed
- User/account information (if known)
- Evidence (screenshots, logs)
- Impact or harm caused

### If Your Site is Being Scraped

Contact: **prateek@coasty.ai**

We will:
- Investigate the report within 24 hours
- Take appropriate action (warnings, bans)
- Notify the offender (if appropriate)
- Implement blocks if necessary

### Reporting Security Vulnerabilities

For security issues: **prateek@coasty.ai**

Use our [Security Policy](SECURITY.md) for responsible disclosure.

---

## Consequences of Misuse

### First Violation
- Warning email
- Temporary suspension (24-48 hours)
- Required review of guidelines

### Second Violation
- Extended suspension (7-30 days)
- Mandatory compliance training
- Enhanced monitoring

### Severe or Repeated Violations
- Permanent account termination
- API access revocation
- Legal action if warranted
- Law enforcement referral (if criminal)

---

## Questions & Support

**Have questions about appropriate use?**

- Discord: [community server](https://discord.gg/gppEfsVt)
- Email: founders@coasty.ai
- Discussions: [GitHub Discussions](https://github.com/coasty-ai/open-computer-use/discussions)

**Need clarification on a specific use case?**

Reach out before proceeding! We're happy to provide guidance.

---

## Acknowledgment

By using Open Computer Use, you acknowledge that:

1. You have read and understood these guidelines
2. You agree to use the platform responsibly
3. You accept accountability for agent actions
4. You will comply with applicable laws and regulations
5. You understand the consequences of misuse

---

## Updates to This Guide

We may update these guidelines periodically. Significant changes will be announced via:
- Email notifications
- Discord announcements
- GitHub releases
- Dashboard notices

Last updated: **October 2025**

---

**Remember:** Open Computer Use is a powerful tool. Use it wisely, ethically, and responsibly to create positive outcomes for yourself and others.

Thank you for being a responsible member of our community!
