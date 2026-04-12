/**
 * Secure VNC WebSocket Proxy with Authentication
 */

import { WebSocketServer, WebSocket } from 'ws';
import net from 'net';
import crypto from 'crypto';
import { verifySecureToken } from '@/lib/utils/encryption';
import { createClient } from '@/lib/supabase/server';

interface VNCProxyConfig {
  port: number;
  authRequired: boolean;
  maxConnections: number;
  connectionTimeout: number;
  rateLimitPerIP: number;
  rateLimitWindow: number;
}

interface ClientConnection {
  websocket: WebSocket;
  vncSocket?: net.Socket;
  authenticated: boolean;
  userId?: string;
  machineId?: string;
  ipAddress: string;
  connectedAt: Date;
  lastActivity: Date;
}

export class SecureVNCProxy {
  private wss: WebSocketServer;
  private config: VNCProxyConfig;
  private connections: Map<string, ClientConnection>;
  private connectionsByIP: Map<string, number>;
  private rateLimitTracker: Map<string, number[]>;
  private auditLog: any[] = [];

  constructor(config: Partial<VNCProxyConfig> = {}) {
    this.config = {
      port: config.port || 6081,
      authRequired: config.authRequired !== false,
      maxConnections: config.maxConnections || 100,
      connectionTimeout: config.connectionTimeout || 600000, // 10 minutes
      rateLimitPerIP: config.rateLimitPerIP || 5,
      rateLimitWindow: config.rateLimitWindow || 60000, // 1 minute
    };

    this.connections = new Map();
    this.connectionsByIP = new Map();
    this.rateLimitTracker = new Map();

    // Create WebSocket server
    this.wss = new WebSocketServer({
      port: this.config.port,
      verifyClient: this.verifyClient.bind(this),
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    
    // Start cleanup interval
    setInterval(() => this.cleanupStaleConnections(), 60000); // Every minute
  }

  /**
   * Verify client before accepting WebSocket connection
   */
  private async verifyClient(
    info: { origin: string; secure: boolean; req: any },
    callback: (res: boolean, code?: number, message?: string) => void
  ) {
    const req = info.req;
    const ip = req.socket.remoteAddress || 'unknown';

    // Check rate limiting
    if (!this.checkRateLimit(ip)) {
      this.logAuditEvent('CONNECTION_RATE_LIMITED', { ip });
      callback(false, 429, 'Too many connections');
      return;
    }

    // Check max connections per IP
    const currentConnections = this.connectionsByIP.get(ip) || 0;
    if (currentConnections >= this.config.rateLimitPerIP) {
      this.logAuditEvent('CONNECTION_LIMIT_EXCEEDED', { ip, currentConnections });
      callback(false, 429, 'Connection limit exceeded');
      return;
    }

    // Check total connections
    if (this.connections.size >= this.config.maxConnections) {
      this.logAuditEvent('SERVER_FULL', { ip, totalConnections: this.connections.size });
      callback(false, 503, 'Server at capacity');
      return;
    }

    callback(true);
  }

  /**
   * Check rate limiting for an IP
   */
  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.rateLimitTracker.get(ip) || [];
    
    // Remove old timestamps outside the window
    const validTimestamps = timestamps.filter(
      t => now - t < this.config.rateLimitWindow
    );
    
    if (validTimestamps.length >= this.config.rateLimitPerIP) {
      return false;
    }
    
    validTimestamps.push(now);
    this.rateLimitTracker.set(ip, validTimestamps);
    return true;
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleConnection(ws: WebSocket, req: any) {
    const connectionId = this.generateConnectionId();
    const ip = req.socket.remoteAddress || 'unknown';
    
    // Create connection record
    const connection: ClientConnection = {
      websocket: ws,
      authenticated: false,
      ipAddress: ip,
      connectedAt: new Date(),
      lastActivity: new Date(),
    };
    
    this.connections.set(connectionId, connection);
    this.incrementConnectionCount(ip);
    
    this.logAuditEvent('CONNECTION_ESTABLISHED', {
      connectionId,
      ip,
    });

    // Set authentication timeout
    const authTimeout = setTimeout(() => {
      if (!connection.authenticated && this.config.authRequired) {
        this.logAuditEvent('AUTH_TIMEOUT', { connectionId, ip });
        ws.close(1008, 'Authentication timeout');
      }
    }, 10000); // 10 seconds to authenticate

    // Handle messages
    ws.on('message', async (data) => {
      connection.lastActivity = new Date();
      
      try {
        const message = JSON.parse(data.toString());
        
        if (!connection.authenticated) {
          // Handle authentication
          if (message.type === 'auth') {
            const authResult = await this.authenticate(message, connection);
            
            if (authResult.success) {
              clearTimeout(authTimeout);
              connection.authenticated = true;
              connection.userId = authResult.userId;
              connection.machineId = authResult.machineId;
              
              // Send auth success
              ws.send(JSON.stringify({
                type: 'auth_success',
                data: { message: 'Authentication successful' }
              }));
              
              // Establish VNC connection
              await this.establishVNCConnection(connection, authResult.vncHost, authResult.vncPort);
              
              this.logAuditEvent('AUTH_SUCCESS', {
                connectionId,
                userId: authResult.userId,
                machineId: authResult.machineId,
              });
            } else {
              this.logAuditEvent('AUTH_FAILED', {
                connectionId,
                ip,
                reason: authResult.reason,
              });
              
              ws.send(JSON.stringify({
                type: 'auth_failed',
                data: { error: authResult.reason }
              }));
              
              ws.close(1008, 'Authentication failed');
            }
          } else {
            ws.close(1008, 'Must authenticate first');
          }
        } else {
          // Forward to VNC if authenticated
          if (connection.vncSocket && !connection.vncSocket.destroyed) {
            connection.vncSocket.write(Buffer.from(data as ArrayBuffer));
          }
        }
      } catch (_error) {
        // If not JSON, forward raw data to VNC (for authenticated connections)
        if (connection.authenticated && connection.vncSocket && !connection.vncSocket.destroyed) {
          connection.vncSocket.write(Buffer.from(data as ArrayBuffer));
        }
      }
    });

    // Handle WebSocket close
    ws.on('close', () => {
      this.handleDisconnection(connectionId);
    });

    // Handle WebSocket error
    ws.on('error', (error) => {
      this.logAuditEvent('WEBSOCKET_ERROR', {
        connectionId,
        error: error.message,
      });
      this.handleDisconnection(connectionId);
    });
  }

  /**
   * Authenticate the connection
   */
  private async authenticate(
    authMessage: any,
    _connection: ClientConnection
  ): Promise<any> {
    if (!this.config.authRequired) {
      // No auth required (development mode)
      return {
        success: true,
        userId: 'anonymous',
        machineId: authMessage.machineId,
        vncHost: authMessage.vncHost || 'localhost',
        vncPort: authMessage.vncPort || 5901,
      };
    }

    try {
      // Verify token
      const token = authMessage.token;
      if (!token) {
        return { success: false, reason: 'No token provided' };
      }

      // Verify and decode token
      const payload = verifySecureToken(token);
      
      // Verify machine access
      const supabase = await createClient();
      if (!supabase) {
        return { success: false, reason: 'Database connection failed' };
      }
      
      const { data: machine, error } = await supabase
        .from('user_machines')
        .select('*')
        .eq('id', payload.machineId)
        .eq('user_id', payload.userId)
        .single();
      
      if (error || !machine) {
        return { success: false, reason: 'Machine not found or access denied' };
      }
      
      if (machine.status !== 'running') {
        return { success: false, reason: 'Machine not running' };
      }

      return {
        success: true,
        userId: payload.userId,
        machineId: payload.machineId,
        vncHost: machine.public_ip_address,
        vncPort: machine.vnc_port || 5901,
      };
    } catch (error: any) {
      return { success: false, reason: error.message || 'Authentication failed' };
    }
  }

  /**
   * Establish connection to VNC server
   */
  private async establishVNCConnection(
    connection: ClientConnection,
    host: string,
    port: number
  ) {
    return new Promise<void>((resolve, reject) => {
      const vncSocket = net.connect({ host, port }, () => {
        connection.vncSocket = vncSocket;
        
        this.logAuditEvent('VNC_CONNECTED', {
          userId: connection.userId,
          machineId: connection.machineId,
          vncHost: host,
          vncPort: port,
        });
        
        resolve();
      });

      // Forward VNC data to WebSocket
      vncSocket.on('data', (data) => {
        if (connection.websocket.readyState === WebSocket.OPEN) {
          connection.websocket.send(data);
        }
      });

      // Handle VNC socket close
      vncSocket.on('close', () => {
        this.logAuditEvent('VNC_DISCONNECTED', {
          userId: connection.userId,
          machineId: connection.machineId,
        });
        
        if (connection.websocket.readyState === WebSocket.OPEN) {
          connection.websocket.close();
        }
      });

      // Handle VNC socket error
      vncSocket.on('error', (error) => {
        this.logAuditEvent('VNC_ERROR', {
          userId: connection.userId,
          machineId: connection.machineId,
          error: error.message,
        });
        
        reject(error);
      });
    });
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(connectionId: string) {
    const connection = this.connections.get(connectionId);
    
    if (connection) {
      // Close VNC socket if exists
      if (connection.vncSocket) {
        connection.vncSocket.destroy();
      }
      
      // Update connection count
      this.decrementConnectionCount(connection.ipAddress);
      
      // Log disconnection
      this.logAuditEvent('CONNECTION_CLOSED', {
        connectionId,
        userId: connection.userId,
        machineId: connection.machineId,
        duration: Date.now() - connection.connectedAt.getTime(),
      });
      
      // Remove connection
      this.connections.delete(connectionId);
    }
  }

  /**
   * Clean up stale connections
   */
  private cleanupStaleConnections() {
    const now = Date.now();
    
    for (const [connectionId, connection] of this.connections.entries()) {
      const idleTime = now - connection.lastActivity.getTime();
      
      if (idleTime > this.config.connectionTimeout) {
        this.logAuditEvent('CONNECTION_TIMEOUT', {
          connectionId,
          userId: connection.userId,
          idleTime,
        });
        
        connection.websocket.close(1000, 'Connection timeout');
        this.handleDisconnection(connectionId);
      }
    }
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `conn_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Track connections per IP
   */
  private incrementConnectionCount(ip: string) {
    const current = this.connectionsByIP.get(ip) || 0;
    this.connectionsByIP.set(ip, current + 1);
  }

  private decrementConnectionCount(ip: string) {
    const current = this.connectionsByIP.get(ip) || 0;
    if (current > 1) {
      this.connectionsByIP.set(ip, current - 1);
    } else {
      this.connectionsByIP.delete(ip);
    }
  }

  /**
   * Log audit event
   */
  private logAuditEvent(eventType: string, details: any) {
    const event = {
      timestamp: new Date().toISOString(),
      type: eventType,
      details,
    };
    
    this.auditLog.push(event);
    console.log(`[AUDIT] ${eventType}:`, details);
    
    // Keep only last 1000 events in memory
    if (this.auditLog.length > 1000) {
      this.auditLog.shift();
    }
  }

  /**
   * Get server statistics
   */
  public getStats() {
    return {
      totalConnections: this.connections.size,
      connectionsByIP: Object.fromEntries(this.connectionsByIP),
      authenticatedConnections: Array.from(this.connections.values()).filter(c => c.authenticated).length,
      recentAuditEvents: this.auditLog.slice(-100),
    };
  }

  /**
   * Start the proxy server
   */
  public start() {
    console.log(`Secure VNC Proxy listening on port ${this.config.port}`);
    console.log(`Authentication required: ${this.config.authRequired}`);
    console.log(`Max connections: ${this.config.maxConnections}`);
    console.log(`Rate limit: ${this.config.rateLimitPerIP} connections per IP per ${this.config.rateLimitWindow}ms`);
  }

  /**
   * Stop the proxy server
   */
  public stop() {
    // Close all connections
    for (const connection of this.connections.values()) {
      connection.websocket.close(1000, 'Server shutting down');
    }
    
    // Close WebSocket server
    this.wss.close();
    
    console.log('Secure VNC Proxy stopped');
  }
}