# WebSocket Authentication Implementation

This document outlines the changes made to implement secure WebSocket authentication for the Multi-Media Chatbot with Nova Sonic integration. It covers both the implementation details and the CloudFront integration for secure WebSocket connections.

## Table of Contents

- [WebSocket Authentication Implementation](#websocket-authentication-implementation)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Implementation Details](#implementation-details)
    - [Frontend Changes](#frontend-changes)
    - [Backend Changes](#backend-changes)
  - [CloudFront Integration](#cloudfront-integration)
    - [Current Configuration](#current-configuration)
    - [Required Changes](#required-changes)
  - [IAM Permission Updates](#iam-permission-updates)
  - [Testing and Verification](#testing-and-verification)
  - [Known Issues](#known-issues)
  - [Future Improvements](#future-improvements)

## Overview

The WebSocket authentication implementation secures the speech-to-speech functionality by ensuring that only authenticated users can establish WebSocket connections between the React frontend and the Python backend server. This is achieved using Cognito JWT tokens for authentication.

## Implementation Details

### Frontend Changes

The frontend implementation in `S2SManager.js` has been updated to include authentication tokens in the WebSocket connection:

```javascript
async connectWebSocket() {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
        try {
            // Get authentication token
            const session = await Auth.currentSession();
            const idToken = session.getIdToken().getJwtToken();
            
            // Add token to WebSocket URL as query parameter
            const wsUrl = `${process.env.REACT_APP_WEBSOCKET_URL}?token=${encodeURIComponent(idToken)}`;
            
            console.log('Connecting to WebSocket with authentication...');
            this.socket = new WebSocket(wsUrl);
            
            // ... rest of the connection setup ...
        } catch (error) {
            console.error("Authentication error:", error);
            this.config.onError("Authentication error: " + error.message);
        }
    }
}
```

The WebSocket URL in the `.env` file has been updated to use the secure WebSocket protocol (wss://) with CloudFront:

```
REACT_APP_WEBSOCKET_URL=wss://d2opapchhrsmfj.cloudfront.net/ws/nova-sonic-backend
```

### Backend Changes

The backend implementation in `server.py` has been updated to:

1. **Extract and validate JWT tokens** from the WebSocket connection URL:

```python
# Check if there's a query string
if '?' in path_with_query:
    query_string = path_with_query.split('?', 1)[1]
    params = urllib.parse.parse_qs(query_string)
    token = params.get('token', [None])[0]
    
    if not token:
        logger.error(f"[AUTH] [{connection_id}] Missing token in query string from {client_ip}")
        await websocket.close(1008, "Missing authentication token")
        return
        
    # Validate the token
    valid, user_id, username = await validate_token(token, client_ip)
    if not valid:
        logger.error(f"[AUTH] [{connection_id}] Invalid token from {client_ip}")
        await websocket.close(1008, "Invalid authentication token")
        return
        
    logger.info(f"[AUTH] [{connection_id}] Authenticated connection from user: {username} ({user_id})")
```

2. **Fix path extraction** to work with websockets 15.0.1:

```python
async def authenticated_handler(websocket, path=None):
    """Wrapper function to pass the path parameter to the websocket_handler"""
    try:
        # Extract path from websocket if not provided
        if path is None:
            if hasattr(websocket, 'path'):
                path = websocket.path
            elif hasattr(websocket, 'request') and hasattr(websocket.request, 'path'):
                path = websocket.request.path
            elif hasattr(websocket, 'uri'):
                path = str(websocket.uri)
            else:
                # Default path if we can't extract it
                path = "/"
```

3. **Add JWT validation** with PyJWT library:

```python
async def validate_token(token, client_ip):
    """Validate the JWT token from Cognito"""
    start_time = time.time()
    logger.debug(f"[AUTH] Starting token validation for request from {client_ip}")
    
    try:
        # Get the key ID from the token header
        header = jwt.get_unverified_header(token)
        kid = header['kid']
        logger.debug(f"[AUTH] Token KID: {kid}")
        
        # Get the JWKs
        jwks = await get_jwks()
        
        # Find the key matching the kid
        key = None
        for jwk in jwks['keys']:
            if jwk['kid'] == kid:
                key = jwk
                break
                
        if not key:
            logger.error(f"[AUTH] Public key not found in JWKS for KID: {kid}")
            return False, None, None
            
        # Convert the JWK to PEM format
        public_key = RSAAlgorithm.from_jwk(json.dumps(key))
        
        # Verify the token
        payload = jwt.decode(
            token,
            public_key,
            algorithms=['RS256'],
            options={
                'verify_signature': True,
                'verify_exp': True,
                'verify_nbf': True,
                'verify_iat': True,
                'verify_aud': False,  # Skip audience verification if not needed
                'verify_iss': True,
                'require': ['exp', 'iat', 'iss']
            },
            issuer=f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{USER_POOL_ID}"
        )
        
        # Extract user information
        user_id = payload.get('sub')
        username = payload.get('username', payload.get('cognito:username', 'unknown'))
        
        validation_time = time.time() - start_time
        logger.info(f"[AUTH] Token validation successful for user {username} ({user_id}) in {validation_time:.2f}s")
        
        return True, user_id, username
        
    except jwt.ExpiredSignatureError:
        logger.error(f"[AUTH] Token has expired for request from {client_ip}")
        return False, None, None
    except jwt.InvalidTokenError as e:
        logger.error(f"[AUTH] Invalid token from {client_ip}: {e}")
        return False, None, None
    except Exception as e:
        logger.error(f"[AUTH] Token validation error from {client_ip}: {e}", exc_info=True)
        return False, None, None
```

4. **Add ping/pong mechanism** for connection health monitoring:

```python
# Configure WebSocket server with ping interval and timeout
server_config = {
    "ping_interval": 20,  # Send ping every 20 seconds
    "ping_timeout": 30,    # Wait 30 seconds for pong response
    "close_timeout": 10,   # Wait 10 seconds for close handshake
}

# Start WebSocket server with configuration
async with websockets.serve(authenticated_handler, host, port, **server_config):
    logger.info(f"WebSocket server started at host:{host}, port:{port}")
```

## CloudFront Integration

To enable secure WebSocket connections (wss://) when the React app is served from CloudFront, we need to configure CloudFront to proxy WebSocket connections to the NLB.

### Current Configuration

The CloudFront distribution has been updated with:

1. **New Origin**: Added the NLB as an origin
   ```
   "Id": "novaso-novas-fjorgdd4bz43-622e4dd0bb63a4c2.elb.us-east-1.amazonaws.com",
   "DomainName": "novaso-novas-fjorgdd4bz43-622e4dd0bb63a4c2.elb.us-east-1.amazonaws.com",
   "OriginProtocolPolicy": "http-only"
   ```

2. **WebSocket Behavior**: Added a behavior for `/ws/*` paths
   ```
   "PathPattern": "/ws/*",
   "TargetOriginId": "novaso-novas-fjorgdd4bz43-622e4dd0bb63a4c2.elb.us-east-1.amazonaws.com",
   "ViewerProtocolPolicy": "redirect-to-https",
   "AllowedMethods": {
       "Quantity": 7,
       "Items": [
           "HEAD", "DELETE", "POST", "GET", "OPTIONS", "PUT", "PATCH"
       ]
   },
   "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
   "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3"
   ```

### Required Changes

For the CloudFront distribution to properly support WebSocket connections, the following changes are needed:

1. **Port Configuration**: Update the NLB origin to use port 8081 (the WebSocket server port)
2. **WebSocket Support**: Enable WebSocket support explicitly
3. **Cache Policy**: Use a cache policy that disables caching for WebSocket connections
4. **Origin Request Policy**: Use a policy that forwards all WebSocket headers

These changes need to be integrated into the CDK code in `guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/cdk/lib/storage-dist-stack.ts`.

## IAM Permission Updates

The ECS task role in `nova-sonic-stack.ts` needs the following permission added:

```typescript
// Add Bedrock permission for Retrieve operation
taskRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'bedrock:Retrieve'  // This permission is missing and needs to be added
  ],
  resources: ['*']
}));
```

## Testing and Verification

To test the WebSocket authentication:

1. Deploy the updated code to AWS
2. Open the React app from CloudFront
3. Sign in with valid credentials
4. Start a conversation to test the WebSocket connection
5. Verify in the logs that authentication is working correctly

## Known Issues

1. **Token Expiration**: JWT tokens from Cognito have an expiration time, but WebSocket connections can stay open longer. A token refresh mechanism is needed for long-lived connections.

2. **CloudFront Configuration**: The CloudFront distribution needs to be properly configured for WebSocket support. If not configured correctly, WebSocket connections will fail with error code 1006.

## Future Improvements

1. **Token Refresh Mechanism**: Implement a mechanism to refresh tokens for long-lived WebSocket connections.

2. **Unified CDK Deployment**: Integrate the Nova Sonic stack into the guidance CDK project for a more cohesive deployment process.

3. **Enhanced Error Handling**: Add more comprehensive error handling and recovery mechanisms for WebSocket connections.

4. **Monitoring Solution**: Implement a more robust monitoring solution for WebSocket connections.
