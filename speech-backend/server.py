import asyncio
import websockets
import json
import logging
import warnings
from s2s_session_manager import S2sSessionManager
import argparse
import http.server
import threading
import os
import time
import urllib.parse
from http import HTTPStatus
import jwt
import requests
from jwt.algorithms import RSAAlgorithm

# Configure logging
LOGLEVEL = os.environ.get("LOGLEVEL", "INFO").upper()
logging.basicConfig(level=LOGLEVEL, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)

# Suppress warnings
warnings.filterwarnings("ignore")

# Enable debugging for troubleshooting
DEBUG = True

# Cognito configuration
USER_POOL_ID = os.environ.get('REACT_APP_USER_POOL_ID')
AWS_REGION = os.environ.get('REACT_APP_AWS_REGION', 'us-west-2')

# Cache for JWKs
jwks_cache = {}
jwks_last_updated = 0

# Print all environment variables for debugging
logger.info("All environment variables:")
for key, value in os.environ.items():
    if key.startswith('REACT_APP_') or key in ['USE_RAG', 'RAG_MODEL_ARN', 'AWS_DEFAULT_REGION', 'KB_ID']:
        logger.info(f"{key}: {value}")

# Print specific environment variables for debugging
logger.info("Knowledge Base environment variables:")
logger.info(f"REACT_APP_DOCUMENTS_KB_ID: {os.environ.get('REACT_APP_DOCUMENTS_KB_ID')}")
logger.info(f"REACT_APP_AWS_REGION: {os.environ.get('REACT_APP_AWS_REGION')}")
logger.info(f"USE_RAG: {os.environ.get('USE_RAG')}")
logger.info(f"RAG_MODEL_ARN: {os.environ.get('RAG_MODEL_ARN')}")

# Print Cognito configuration
logger.info("Cognito configuration:")
logger.info(f"USER_POOL_ID: {USER_POOL_ID}")
logger.info(f"AWS_REGION: {AWS_REGION}")

# Set default environment variables if not already set
if not os.environ.get('REACT_APP_DOCUMENTS_KB_ID'):
    logger.warning("REACT_APP_DOCUMENTS_KB_ID not set, checking for KB_ID")
    if os.environ.get('KB_ID'):
        os.environ['REACT_APP_DOCUMENTS_KB_ID'] = os.environ.get('KB_ID')
        logger.info(f"Set REACT_APP_DOCUMENTS_KB_ID from KB_ID: {os.environ.get('REACT_APP_DOCUMENTS_KB_ID')}")
    else:
        # Hardcoded fallback for testing
        logger.warning("KB_ID not set either, using hardcoded value for testing")
        os.environ['REACT_APP_DOCUMENTS_KB_ID'] = '3QZG4IXJK3'
        logger.info(f"Set REACT_APP_DOCUMENTS_KB_ID to hardcoded value: {os.environ.get('REACT_APP_DOCUMENTS_KB_ID')}")

if not os.environ.get('REACT_APP_AWS_REGION'):
    logger.warning("REACT_APP_AWS_REGION not set, checking for AWS_DEFAULT_REGION")
    if os.environ.get('AWS_DEFAULT_REGION'):
        os.environ['REACT_APP_AWS_REGION'] = os.environ.get('AWS_DEFAULT_REGION')
        logger.info(f"Set REACT_APP_AWS_REGION from AWS_DEFAULT_REGION: {os.environ.get('REACT_APP_AWS_REGION')}")
    else:
        # Hardcoded fallback for testing
        logger.warning("AWS_DEFAULT_REGION not set either, using hardcoded value for testing")
        os.environ['REACT_APP_AWS_REGION'] = 'us-west-2'
        logger.info(f"Set REACT_APP_AWS_REGION to hardcoded value: {os.environ.get('REACT_APP_AWS_REGION')}")

# Ensure USE_RAG is set
if not os.environ.get('USE_RAG'):
    logger.warning("USE_RAG not set, defaulting to true")
    os.environ['USE_RAG'] = 'true'
    logger.info(f"Set USE_RAG to default value: {os.environ.get('USE_RAG')}")

# Ensure RAG_MODEL_ARN is set
if not os.environ.get('RAG_MODEL_ARN'):
    logger.warning("RAG_MODEL_ARN not set, defaulting to Claude 3 Haiku")
    os.environ['RAG_MODEL_ARN'] = 'anthropic.claude-3-haiku-20240307-v1:0'
    logger.info(f"Set RAG_MODEL_ARN to default value: {os.environ.get('RAG_MODEL_ARN')}")

# Print final environment variables after all defaults are applied
logger.info("Final Knowledge Base environment variables:")
logger.info(f"REACT_APP_DOCUMENTS_KB_ID: {os.environ.get('REACT_APP_DOCUMENTS_KB_ID')}")
logger.info(f"REACT_APP_AWS_REGION: {os.environ.get('REACT_APP_AWS_REGION')}")
logger.info(f"USE_RAG: {os.environ.get('USE_RAG')}")
logger.info(f"RAG_MODEL_ARN: {os.environ.get('RAG_MODEL_ARN')}")

def debug_print(message):
    """Print only if debug mode is enabled"""
    if DEBUG:
        print(message)

async def get_jwks():
    """Get the JSON Web Key Set for the Cognito User Pool"""
    global jwks_cache, jwks_last_updated
    current_time = time.time()
    
    # Refresh cache if older than 1 hour or if it's empty
    if not jwks_cache or current_time - jwks_last_updated > 3600:
        logger.debug("[AUTH] Fetching JWKS from Cognito")
        start_time = time.time()
        
        try:
            jwks_url = f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
            response = requests.get(jwks_url)
            response.raise_for_status()  # Raise exception for non-200 status codes
            jwks_cache = response.json()
            jwks_last_updated = current_time
            
            fetch_time = time.time() - start_time
            logger.info(f"[AUTH] JWKS fetched successfully in {fetch_time:.2f}s")
        except Exception as e:
            logger.error(f"[AUTH] Error fetching JWKS: {e}", exc_info=True)
            # If we have a cached version, use it even if it's expired
            if not jwks_cache:
                raise
    else:
        logger.debug("[AUTH] Using cached JWKS")
        
    return jwks_cache

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

class HealthCheckHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        client_ip = self.client_address[0]
        logger.info(
            f"Health check request received from {client_ip} for path: {self.path}"
        )

        if self.path == "/health" or self.path == "/":
            logger.info(f"Responding with 200 OK to health check from {client_ip}")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response = json.dumps({"status": "healthy"})
            self.wfile.write(response.encode("utf-8"))
            logger.info(f"Health check response sent: {response}")
        else:
            logger.info(
                f"Responding with 404 Not Found to request for {self.path} from {client_ip}"
            )
            self.send_response(HTTPStatus.NOT_FOUND)
            self.end_headers()

    def log_message(self, format, *args):
        # Override to use our logger instead
        pass


def start_health_check_server(health_host, health_port):
    """Start the HTTP health check server on port 80."""
    try:
        # Create the server with a socket timeout to prevent hanging
        httpd = http.server.HTTPServer((health_host, health_port), HealthCheckHandler)
        httpd.timeout = 5  # 5 second timeout

        logger.info(f"Starting health check server on {health_host}:{health_port}")

        # Run the server in a separate thread
        thread = threading.Thread(target=httpd.serve_forever)
        thread.daemon = (
            True  # This ensures the thread will exit when the main program exits
        )
        thread.start()

        # Verify the server is running
        logger.info(
            f"Health check server started at http://{health_host}:{health_port}/health"
        )
        logger.info(f"Health check thread is alive: {thread.is_alive()}")

        # Try to make a local request to verify the server is responding
        try:
            import urllib.request

            with urllib.request.urlopen(
                f"http://localhost:{health_port}/health", timeout=2
            ) as response:
                logger.info(
                    f"Local health check test: {response.status} - {response.read().decode('utf-8')}"
                )
        except Exception as e:
            logger.warning(f"Local health check test failed: {e}")

    except Exception as e:
        logger.error(f"Failed to start health check server: {e}", exc_info=True)


async def websocket_handler(websocket, path=None):
    """Handle WebSocket connections with authentication"""
    stream_manager = None
    forward_task = None  # Define this here to avoid scope issues
    connection_start_time = time.time()
    client_ip = websocket.remote_address[0] if hasattr(websocket, 'remote_address') else 'unknown'
    user_id = None
    username = None
    connection_id = f"conn-{int(connection_start_time)}"
    
    logger.info(f"[CONN] [{connection_id}] New connection from {client_ip}")
    
    try:
        # Get path from parameter or try to extract it from various attributes
        if path is None:
            if hasattr(websocket, 'request') and hasattr(websocket.request, 'path'):
                path = websocket.request.path
            elif hasattr(websocket, 'path'):
                path = websocket.path
            elif hasattr(websocket, 'uri'):
                path = str(websocket.uri)
            else:
                logger.error(f"[AUTH] [{connection_id}] Unable to extract path from WebSocket connection")
                await websocket.close(1008, "Unable to extract path for authentication")
                return
                
        path_with_query = path
        logger.debug(f"[CONN] [{connection_id}] Path: {path_with_query}")
        
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
        else:
            logger.error(f"[AUTH] [{connection_id}] No query string in WebSocket path from {client_ip}")
            await websocket.close(1008, "Missing authentication token")
            return
        
        # Process messages
        message_count = 0
        async for message in websocket:
            message_count += 1
            message_start_time = time.time()
            
            try:
                data = json.loads(message)
                if 'body' in data:
                    data = json.loads(data["body"])
                if 'event' in data:
                    # Define event_type BEFORE using it
                    event_type = list(data['event'].keys())[0] if data['event'] else None
                    logger.debug(f"[MSG] [{connection_id}] Received message type: {event_type}, size: {len(message)} bytes")
                    
                    if stream_manager == None:
                        # Create a new stream manager for this connection
                        logger.info(f"[CONN] [{connection_id}] Initializing stream manager for user: {username}")
                        stream_manager = S2sSessionManager(model_id='amazon.nova-sonic-v1:0', region='us-east-1')
                        
                        # Initialize the Bedrock stream
                        await stream_manager.initialize_stream()
                        
                        # Start a task to forward responses from Bedrock to the WebSocket
                        forward_task = asyncio.create_task(forward_responses(websocket, stream_manager, connection_id))

                        # Now it's safe to use event_type
                        if event_type == "audioInput":
                            debug_print(message[0:180])
                        else:
                            debug_print(message)
                            
                    if event_type:
                        # Store prompt name and content names if provided
                        if event_type == 'promptStart':
                            stream_manager.prompt_name = data['event']['promptStart']['promptName']
                            logger.debug(f"[MSG] [{connection_id}] Set prompt name: {stream_manager.prompt_name}")
                        elif event_type == 'contentStart' and data['event']['contentStart'].get('type') == 'AUDIO':
                            stream_manager.audio_content_name = data['event']['contentStart']['contentName']
                            logger.debug(f"[MSG] [{connection_id}] Set audio content name: {stream_manager.audio_content_name}")
                        
                        # Handle audio input separately
                        if event_type == 'audioInput':
                            # Extract audio data
                            prompt_name = data['event']['audioInput']['promptName']
                            content_name = data['event']['audioInput']['contentName']
                            audio_base64 = data['event']['audioInput']['content']
                            
                            # Add to the audio queue
                            stream_manager.add_audio_chunk(prompt_name, content_name, audio_base64)
                            logger.debug(f"[MSG] [{connection_id}] Added audio chunk to queue")
                        else:
                            # Send other events directly to Bedrock
                            await stream_manager.send_raw_event(data)
                            logger.debug(f"[MSG] [{connection_id}] Sent event to Bedrock: {event_type}")
                
                message_processing_time = time.time() - message_start_time
                logger.debug(f"[PERF] [{connection_id}] Message processing time: {message_processing_time:.2f}s")
                
            except json.JSONDecodeError:
                logger.error(f"[MSG] [{connection_id}] Invalid JSON received from WebSocket")
            except Exception as e:
                logger.error(f"[MSG] [{connection_id}] Error processing WebSocket message: {e}")
                if DEBUG:
                    import traceback
                    traceback.print_exc()
    except websockets.exceptions.ConnectionClosed:
        connection_duration = time.time() - connection_start_time
        logger.info(f"[CONN] [{connection_id}] WebSocket connection closed for user: {username}, duration: {connection_duration:.2f}s, messages: {message_count}")
    finally:
        # Clean up
        if stream_manager:
            await stream_manager.close()
            logger.debug(f"[CONN] [{connection_id}] Stream manager closed")
        if 'forward_task' in locals() and forward_task:
            forward_task.cancel()
            logger.debug(f"[CONN] [{connection_id}] Forward task cancelled")
        if websocket:
            websocket.close()
            logger.debug(f"[CONN] [{connection_id}] WebSocket closed")


async def forward_responses(websocket, stream_manager, connection_id):
    """Forward responses from Bedrock to the WebSocket."""
    message_count = 0
    try:
        while True:
            # Get next response from the output queue
            response = await stream_manager.output_queue.get()
            message_count += 1
            
            # Extract event type for logging
            event_type = None
            if isinstance(response, dict) and 'event' in response:
                event_keys = list(response['event'].keys())
                if event_keys:
                    event_type = event_keys[0]
            
            logger.debug(f"[MSG] [{connection_id}] Forwarding response type: {event_type}")
            
            # Send to WebSocket
            try:
                event = json.dumps(response)
                await websocket.send(event)
                logger.debug(f"[MSG] [{connection_id}] Response sent to client, size: {len(event)} bytes")
            except websockets.exceptions.ConnectionClosed:
                logger.info(f"[CONN] [{connection_id}] Connection closed while forwarding response")
                break
    except asyncio.CancelledError:
        # Task was cancelled
        logger.debug(f"[CONN] [{connection_id}] Forward task cancelled after {message_count} messages")
        pass
    except Exception as e:
        logger.error(f"[CONN] [{connection_id}] Error forwarding responses: {e}", exc_info=True)
        # Close connection
        websocket.close()
        stream_manager.close()

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
                
        # Debug info
        logger.info(f"New WebSocket connection with path: {path}")
        
        # Handle health checks and other non-WebSocket requests gracefully
        if path == "/health" or path == "/":
            logger.info(f"Health check via WebSocket, responding with 200 OK")
            try:
                await websocket.send(json.dumps({"status": "healthy"}))
            except:
                pass
            return
            
        # For actual WebSocket connections, proceed with the handler
        await websocket_handler(websocket, path)
    except websockets.exceptions.ConnectionClosed:
        logger.info("Connection closed during handshake")
    except Exception as e:
        logger.error(f"Error in authenticated_handler: {e}", exc_info=True)

async def main(host, port, health_port):
    if health_port:
        try:
            start_health_check_server(host, health_port)
        except Exception as ex:
            logger.error(f"Failed to start health check endpoint: {ex}", exc_info=True)

    """Main function to run the WebSocket server."""
    try:
        # Configure WebSocket server with ping interval and timeout
        # This helps keep connections alive and detect disconnections
        server_config = {
            "ping_interval": 20,  # Send ping every 20 seconds
            "ping_timeout": 30,    # Wait 30 seconds for pong response
            "close_timeout": 10,   # Wait 10 seconds for close handshake
        }
        
        # Start WebSocket server with configuration
        async with websockets.serve(authenticated_handler, host, port, **server_config):
            logger.info(f"WebSocket server started at host:{host}, port:{port}")
            
            # Keep the server running forever
            await asyncio.Future()
    except Exception as ex:
        logger.error(f"Failed to start websocket service: {ex}", exc_info=True)

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Nova S2S WebSocket Server')
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')
    args = parser.parse_args()

    # Environment variables required for host and ports: 
    # HOST: for both websocket and health check
    # WS_PORT: websocket port. 8081
    # HEALTH_PORT (optional): health check HTTP port. 8082

    host, port, health_port = None, None, None
    if os.getenv("HOST"):
        host = str(os.getenv("HOST"))
    if os.getenv("WS_PORT"):
        port = int(os.getenv("WS_PORT"))
    if os.getenv("HEALTH_PORT"):
        health_port = int(os.getenv("HEALTH_PORT"))

    if not host or not port:
        logger.error(f"HOST and PORT are required. Received HOST: {host}, PORT: {port}")
    else:
        try:
            asyncio.run(main(host, port, health_port))
        except KeyboardInterrupt:
            logger.info("Server stopped by user")
        except Exception as e:
            logger.error(f"Server error: {e}", exc_info=True)
            if args.debug:
                import traceback
                traceback.print_exc()
