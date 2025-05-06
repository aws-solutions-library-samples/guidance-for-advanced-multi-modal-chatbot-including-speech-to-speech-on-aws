# WebSocket Authentication Implementation

This document outlines the secure WebSocket authentication implementation for the Multi-Media Chatbot with Speech-to-Speech integration. It covers both the implementation details and the CloudFront integration for secure WebSocket connections.

## Table of Contents

- [WebSocket Authentication Implementation](#websocket-authentication-implementation)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Implementation Details](#implementation-details)
    - [Frontend Changes](#frontend-changes)
    - [Backend Changes](#backend-changes)
  - [CloudFront Integration](#cloudfront-integration)
    - [Configuration Details](#configuration-details)
  - [IAM Permission Updates](#iam-permission-updates)
  - [Testing and Verification](#testing-and-verification)
  - [Known Issues](#known-issues)
  - [Future Improvements](#future-improvements)

## Overview

The WebSocket authentication implementation secures the speech-to-speech functionality by ensuring that only authenticated users can establish WebSocket connections between the React frontend and the Python backend server. This is achieved using Cognito JWT tokens for authentication.

## Implementation Details

### Frontend Changes

The frontend implementation in the Speech-to-Speech module includes authentication tokens in the WebSocket connection:

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

The WebSocket URL in the `.env` file automatically uses the secure WebSocket protocol (wss://) with CloudFront when deployed:

```
REACT_APP_WEBSOCKET_URL=wss://<cloudfront-domain>/ws/speech-to-speech
```

### Backend Changes

The backend implementation in `speech-backend/server.py` includes:

1. **JWT Token Extraction and Validation**:

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

2. **Robust Path Extraction** compatible with websockets 15.0.1:

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

3. **JWT Validation with PyJWT** for secure token verification:

```python
async def validate_token(token, client_ip):
    """Validate the JWT token from Cognito"""
    # ... token validation code ...
```

4. **Connection Health Monitoring** with ping/pong:

```python
# Configure WebSocket server with ping interval and timeout
server_config = {
    "ping_interval": 20,  # Send ping every 20 seconds
    "ping_timeout": 30,    # Wait 30 seconds for pong response
    "close_timeout": 10,   # Wait 10 seconds for close handshake
}
```

## CloudFront Integration

To enable secure WebSocket connections (wss://) when the React app is served from CloudFront, the CDK deployment automatically configures CloudFront to proxy WebSocket connections to the Network Load Balancer.

### Configuration Details

The CloudFront distribution is configured with:

1. **NLB Origin** for WebSocket communication:
   ```typescript
   const nlbOrigin = new origins.LoadBalancerV2Origin(speechBackendNlb, {
     protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
     connectionPort: 8081, // WebSocket port
     connectionTimeout: cdk.Duration.seconds(10),
     customHeaders: {
       'X-Origin-Auth': 'speech-to-speech'  // Optional security header
     }
   });
   ```

2. **WebSocket Behavior** for `/ws/*` paths:
   ```typescript
   distribution.addBehavior('/ws/*', nlbOrigin, {
     viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
     allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
     cachePolicy: new cloudfront.CachePolicy(this, 'WebSocketCachePolicy', {
       enableAcceptEncodingGzip: true,
       enableAcceptEncodingBrotli: true,
       minTtl: cdk.Duration.seconds(0),
       maxTtl: cdk.Duration.seconds(0),
       defaultTtl: cdk.Duration.seconds(0),
       cookieBehavior: cloudfront.CacheCookieBehavior.all(),
       headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
         'Sec-WebSocket-Key',
         'Sec-WebSocket-Version',
         'Sec-WebSocket-Extensions',
         'Sec-WebSocket-Protocol'
       ),
       queryStringBehavior: cloudfront.CacheQueryStringBehavior.all()
     }),
     originRequestPolicy: new cloudfront.OriginRequestPolicy(this, 'WebSocketOriginRequestPolicy', {
       cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
       headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
         'Sec-WebSocket-Key',
         'Sec-WebSocket-Version',
         'Sec-WebSocket-Extensions',
         'Sec-WebSocket-Protocol',
         'Connection',
         'Upgrade'
       ),
       queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all()
     })
   });
   ```

## IAM Permission Updates

The ECS task role in `speech-to-speech-stack.ts` includes comprehensive permissions for:

1. **Bedrock Operations** including bidirectional streaming:
   ```typescript
   taskRole.addToPolicy(new iam.PolicyStatement({
     actions: [
       'bedrock:InvokeModel',
       'bedrock:InvokeModelWithResponseStream',
       'bedrock:InvokeModelWithBidirectionalStream',
       'bedrock:RetrieveAndGenerate',
       'bedrock:GetModelCustomizationJob',
       'bedrock:ListFoundationModels',
       'bedrock:ListModelCustomizationJobs'
     ],
     resources: [
       `arn:aws:bedrock:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:*`
     ]
   }));
   ```

2. **Bedrock Agent Runtime Operations** for knowledge base access:
   ```typescript
   taskRole.addToPolicy(new iam.PolicyStatement({
     actions: [
       'bedrock-agent-runtime:Retrieve',
       'bedrock-agent-runtime:RetrieveAndGenerate'
     ],
     resources: ['*'] // Cross-region access
   }));
   ```

3. **Cognito Operations** for token validation:
   ```typescript
   taskRole.addToPolicy(new iam.PolicyStatement({
     actions: [
       'cognito-idp:GetUser',
       'cognito-idp:DescribeUserPool',
       'cognito-idp:DescribeUserPoolClient'
     ],
     resources: cognitoResources
   }));
   ```

## Testing and Verification

To test the WebSocket authentication:

1. Deploy the solution using the unified deployment script:
   ```bash
   ./deploy.sh -e dev -r us-east-1
   ```
   Note: Speech-to-Speech capabilities require deployment in us-east-1 region.

2. Open the React app from the CloudFront URL provided in the deployment output
3. Sign in with valid credentials
4. Click on the microphone icon to start a speech-to-speech conversation
5. Verify in the CloudWatch logs that authentication is working correctly

## Known Issues

1. **Token Expiration**: JWT tokens from Cognito have an expiration time, but WebSocket connections can stay open longer. A token refresh mechanism is needed for long-lived connections.

2. **Region Limitations**: The Speech-to-Speech functionality using Amazon Nova Sonic is currently only available in the us-east-1 region.

3. **CloudFront Configuration**: WebSocket connections require specific CloudFront configuration. If not configured correctly, connections will fail with error code 1006.

## Future Improvements

1. **Token Refresh Mechanism**: Implement a mechanism to refresh tokens for long-lived WebSocket connections.

2. **HTTPS/WSS Support for Local Development**: Add support for secure WebSocket connections during local development.

3. **Enhanced Error Handling**: Add more comprehensive error handling and recovery mechanisms for WebSocket connections.

4. **Monitoring Dashboard**: Implement a more comprehensive CloudWatch dashboard for monitoring WebSocket connections and speech-to-speech metrics.
