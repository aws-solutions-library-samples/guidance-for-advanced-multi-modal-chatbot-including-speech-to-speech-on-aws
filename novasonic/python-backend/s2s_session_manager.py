import asyncio
import json
import base64
import warnings
import uuid
import time
import os
import datetime
import bedrock_knowledge_bases as kb
from aws_sdk_bedrock_runtime.client import BedrockRuntimeClient, InvokeModelWithBidirectionalStreamOperationInput
from aws_sdk_bedrock_runtime.models import InvokeModelWithBidirectionalStreamInputChunk, BidirectionalInputPayloadPart
from aws_sdk_bedrock_runtime.config import Config, HTTPAuthSchemeResolver, SigV4AuthScheme
from smithy_aws_core.credentials_resolvers.environment import EnvironmentCredentialsResolver

# Suppress warnings
warnings.filterwarnings("ignore")

DEBUG = False

def debug_print(message):
    """Print only if debug mode is enabled"""
    if DEBUG:
        print(message)


class S2sSessionManager:
    """Manages bidirectional streaming with AWS Bedrock using asyncio"""
    
    def __init__(self, model_id='amazon.nova-sonic-v1:0', region='us-east-1'):
        """Initialize the stream manager."""
        self.model_id = model_id
        self.region = region
        
        # Audio and output queues
        self.audio_input_queue = asyncio.Queue()
        self.output_queue = asyncio.Queue()
        
        self.response_task = None
        self.stream = None
        self.is_active = False
        self.bedrock_client = None
        
        # Session information
        self.prompt_name = None  # Will be set from frontend
        self.content_name = None  # Will be set from frontend
        self.audio_content_name = None  # Will be set from frontend
        self.toolUseContent = ""
        self.toolUseId = ""
        self.toolName = ""
        
        # Credential management
        self.credentials = None
        self.credentials_expiration = None
        self.credential_refresh_margin = 300  # Refresh 5 minutes before expiration
        self.credential_refresh_task = None
        self.credential_refresh_interval = 3600  # Check credentials every hour

    def _refresh_credentials(self):
        """Refresh AWS credentials and update environment variables."""
        try:
            import boto3
            
            # Refreshing credentials
            session = boto3.Session(region_name=self.region)
            self.credentials = session.get_credentials()
            
            if self.credentials:
                # Set environment variables for Smithy authentication
                os.environ['AWS_ACCESS_KEY_ID'] = self.credentials.access_key
                os.environ['AWS_SECRET_ACCESS_KEY'] = self.credentials.secret_key
                
                if self.credentials.token:
                    os.environ['AWS_SESSION_TOKEN'] = self.credentials.token
                
                # Get expiration time if available (for temporary credentials)
                if hasattr(self.credentials, 'expiry_time'):
                    self.credentials_expiration = self.credentials.expiry_time
                    # Store expiration time
                else:
                    # For long-term credentials, set a default expiration (24 hours from now)
                    self.credentials_expiration = datetime.datetime.now() + datetime.timedelta(hours=24)
                    # Using long-term credentials
                
                # Credentials refreshed successfully
                return True
            else:
                print("No AWS credentials found via boto3")
                return False
        except Exception as e:
            print(f"Error refreshing AWS credentials: {str(e)}")
            return False
    
    def _should_refresh_credentials(self):
        """Check if credentials should be refreshed."""
        if not self.credentials or not self.credentials_expiration:
            return True
            
        # Calculate time until expiration
        now = datetime.datetime.now()
        if isinstance(self.credentials_expiration, str):
            try:
                expiration = datetime.datetime.fromisoformat(self.credentials_expiration.replace('Z', '+00:00'))
            except:
                # If parsing fails, refresh to be safe
                return True
        else:
            expiration = self.credentials_expiration
            
        time_until_expiration = (expiration - now).total_seconds()
        
        # Refresh if expiring soon or already expired
        return time_until_expiration < self.credential_refresh_margin
    
    def _initialize_client(self):
        """Initialize the Bedrock client with fresh credentials."""
        # Refresh credentials
        if not self._refresh_credentials():
            raise Exception("Failed to refresh AWS credentials")
        
        # Initialize the Bedrock client
        config = Config(
            endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
            region=self.region,
            aws_credentials_identity_resolver=EnvironmentCredentialsResolver(),
            http_auth_scheme_resolver=HTTPAuthSchemeResolver(),
            http_auth_schemes={"aws.auth#sigv4": SigV4AuthScheme()}
        )
        self.bedrock_client = BedrockRuntimeClient(config=config)

    async def _periodic_credential_refresh(self):
        """Periodically check and refresh credentials."""
        while self.is_active:
            try:
                # Wait for the refresh interval
                await asyncio.sleep(self.credential_refresh_interval)
                
                # Check if credentials need refreshing
                if self._should_refresh_credentials():
                    # Refreshing credentials periodically
                    self._refresh_credentials()
                else:
                    # Credentials still valid, no refresh needed
                    pass
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error in periodic credential refresh: {e}")
                await asyncio.sleep(60)  # Wait a bit before retrying if there was an error

    async def initialize_stream(self):
        """Initialize the bidirectional stream with Bedrock."""
        try:
            # Check if we need to initialize or refresh the client
            if not self.bedrock_client or self._should_refresh_credentials():
                print("Initializing/refreshing Bedrock client with fresh credentials")
                self._initialize_client()
                
            # Start the periodic credential refresh task if not already running
            if not self.credential_refresh_task or self.credential_refresh_task.done():
                self.credential_refresh_task = asyncio.create_task(self._periodic_credential_refresh())
        except Exception as e:
            self.is_active = False
            print(f"Failed to initialize Bedrock client: {str(e)}")
            raise

        max_retries = 2
        retry_count = 0
        
        while retry_count <= max_retries:
            try:
                # Initialize the stream
                self.stream = await self.bedrock_client.invoke_model_with_bidirectional_stream(
                    InvokeModelWithBidirectionalStreamOperationInput(model_id=self.model_id)
                )
                self.is_active = True
                
                # Start listening for responses
                self.response_task = asyncio.create_task(self._process_responses())

                # Start processing audio input
                asyncio.create_task(self._process_audio_input())
                
                # Wait a bit to ensure everything is set up
                await asyncio.sleep(0.1)
                
                print("Stream initialized successfully")
                return self
                
            except Exception as e:
                error_message = str(e).lower()
                retry_count += 1
                
                # Check if this is a credential-related error
                if any(keyword in error_message for keyword in ['credential', 'auth', 'token', 'permission', 'access']):
                    if retry_count <= max_retries:
                        print(f"Credential error detected: {e}. Refreshing credentials and retrying...")
                        self._refresh_credentials()
                        continue
                
                self.is_active = False
                print(f"Failed to initialize stream after {retry_count} attempts: {str(e)}")
                raise
    
    async def send_raw_event(self, event_data):
        """Send a raw event to the Bedrock stream."""
        if not self.stream or not self.is_active:
            debug_print("Stream not initialized or closed")
            return
        
        # Check if credentials need refreshing before sending event
        if self._should_refresh_credentials():
            print("Credentials need refreshing before sending event")
            try:
                self._refresh_credentials()
            except Exception as e:
                print(f"Error refreshing credentials: {e}")
                # Continue anyway and let the error handling below catch any issues
        
        max_retries = 2
        retry_count = 0
        
        while retry_count <= max_retries:
            try:
                event_json = json.dumps(event_data)
                event = InvokeModelWithBidirectionalStreamInputChunk(
                    value=BidirectionalInputPayloadPart(bytes_=event_json.encode('utf-8'))
                )
                await self.stream.input_stream.send(event)

                # Close session
                if "sessionEnd" in event_data["event"]:
                    self.close()
                
                # If we get here, the event was sent successfully
                return
                
            except Exception as e:
                error_message = str(e).lower()
                retry_count += 1
                
                # Check if this is a credential-related error
                if any(keyword in error_message for keyword in ['credential', 'auth', 'token', 'permission', 'access']):
                    if retry_count <= max_retries:
                        print(f"Credential error when sending event: {e}. Refreshing credentials and retrying...")
                        self._refresh_credentials()
                        
                        # If this was the last event (sessionEnd), we should close the session
                        if "sessionEnd" in event_data["event"]:
                            self.close()
                            return
                            
                        # For other events, try to reinitialize the stream
                        try:
                            await self.initialize_stream()
                            continue  # Try sending the event again
                        except Exception as init_error:
                            print(f"Failed to reinitialize stream: {init_error}")
                            self.close()
                            return
                
                print(f"Error sending event after {retry_count} attempts: {e}")
                if retry_count > max_retries:
                    break
    
    async def _process_audio_input(self):
        """Process audio input from the queue and send to Bedrock."""
        while self.is_active:
            try:
                # Get audio data from the queue
                data = await self.audio_input_queue.get()
                
                # Extract data from the queue item
                prompt_name = data.get('prompt_name')
                content_name = data.get('content_name')
                audio_bytes = data.get('audio_bytes')
                
                if not audio_bytes or not prompt_name or not content_name:
                    debug_print("Missing required audio data properties")
                    continue

                # Create the audio input event
                audio_event = {
                    "event": {
                        "audioInput": {
                            "promptName": prompt_name,
                            "contentName": content_name,
                            "content": audio_bytes.decode('utf-8') if isinstance(audio_bytes, bytes) else audio_bytes
                        }
                    }
                }
                
                # Send the event
                await self.send_raw_event(audio_event)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                debug_print(f"Error processing audio: {e}")
                if DEBUG:
                    import traceback
                    traceback.print_exc()
    
    def add_audio_chunk(self, prompt_name, content_name, audio_data):
        """Add an audio chunk to the queue."""
        # The audio_data is already a base64 string from the frontend
        self.audio_input_queue.put_nowait({
            'prompt_name': prompt_name,
            'content_name': content_name,
            'audio_bytes': audio_data
        })
    
    async def _process_responses(self):
        """Process incoming responses from Bedrock."""
        while self.is_active:
            try:            
                output = await self.stream.await_output()
                result = await output[1].receive()
                
                if result.value and result.value.bytes_:
                    response_data = result.value.bytes_.decode('utf-8')
                    
                    json_data = json.loads(response_data)
                    json_data["timestamp"] = int(time.time() * 1000)  # Milliseconds since epoch
                    
                    event_name = None
                    if 'event' in json_data:
                        event_name = list(json_data["event"].keys())[0]
                        # if event_name == "audioOutput":
                        #     print(json_data)
                        
                        # Handle tool use detection
                        if event_name == 'toolUse':
                            self.toolUseContent = json_data['event']['toolUse']
                            self.toolName = json_data['event']['toolUse']['toolName']
                            self.toolUseId = json_data['event']['toolUse']['toolUseId']
                            debug_print(f"Tool use detected: {self.toolName}, ID: {self.toolUseId}, "+ json.dumps(json_data['event']))

                        # Process tool use when content ends
                        elif event_name == 'contentEnd' and json_data['event'][event_name].get('type') == 'TOOL':
                            prompt_name = json_data['event']['contentEnd'].get("promptName")
                            debug_print("Processing tool use and sending result")
                            toolResult = await self.processToolUse(self.toolName, self.toolUseContent)
                            
                            # Send tool start event
                            toolContent = str(uuid.uuid4())
                            tool_start_event = {
                                "event": {
                                    "contentStart": {
                                        "promptName": prompt_name,
                                        "contentName": toolContent,
                                        "type": "TOOL",
                                        "role": "TOOL",
                                        "toolResultInputConfiguration": {
                                            "toolUseId": self.toolUseId,
                                            "type": "TEXT",
                                            "textInputConfiguration": {
                                                "mediaType": "text/plain"
                                            }
                                        }
                                    }
                                }
                            }
                            await self.send_raw_event(tool_start_event)
                            
                            # Send tool result event
                            if isinstance(toolResult, dict):
                                content_json_string = json.dumps(toolResult)
                            else:
                                content_json_string = toolResult

                            tool_result_event = {
                                "event": {
                                    "toolResult": {
                                        "promptName": prompt_name,
                                        "contentName": toolContent,
                                        "content": content_json_string
                                    }
                                }
                            }
                            await self.send_raw_event(tool_result_event)

                            # Send tool content end event
                            tool_content_end_event = {
                                "event": {
                                    "contentEnd": {
                                        "promptName": prompt_name,
                                        "contentName": toolContent
                                    }
                                }
                            }
                            await self.send_raw_event(tool_content_end_event)
                    
                    # Put the response in the output queue for forwarding to the frontend
                    await self.output_queue.put(json_data)


            except json.JSONDecodeError as ex:
                print(ex)
                await self.output_queue.put({"raw_data": response_data})
            except StopAsyncIteration as ex:
                # Stream has ended
                print(ex)
            except Exception as e:
                # Handle ValidationException properly
                if "ValidationException" in str(e):
                    error_message = str(e)
                    print(f"Validation error: {error_message}")
                else:
                    print(f"Error receiving response: {e}")
                break

        self.is_active = False
        self.close()

    async def processToolUse(self, toolName, toolUseContent):
        """Return the tool result"""
        print(f"Tool Use Content: {toolUseContent}")

        query = None
        if toolUseContent.get("content"):
            # Parse the JSON string in the content field
            query_json = json.loads(toolUseContent.get("content"))
            query = query_json.get("argName1", "")
            print(f"Extracted query: {query}")
        
        if toolName == "getKbTool":
            if not query:
                query = "amazon community policy"
            
            # Check if we should use RAG (retrieve and generate) or just retrieve
            use_rag = os.environ.get('USE_RAG', 'false').lower() == 'true'
            
            if use_rag:
                # Use the enhanced RAG capabilities
                result = kb.retrieve_and_generation(query)
                return { "result": result }
            else:
                # Use the basic retrieval
                result = kb.retrieve_kb(query)
                return { "result": result }
        
        if toolName == "getDateTool":
            from datetime import datetime, timezone
            return {"result":  datetime.now(timezone.utc).strftime('%A, %Y-%m-%d %H-%M-%S')}
        
        if toolName == "getTravelPolicyTool":
            return {"result": "Travel with pet is not allowed at the XYZ airline."}

        return {}
    
    async def close(self):
        """Close the stream properly."""
        if not self.is_active:
            return
            
        self.is_active = False
        
        # Cancel the credential refresh task
        if self.credential_refresh_task and not self.credential_refresh_task.done():
            print("Cancelling credential refresh task")
            self.credential_refresh_task.cancel()
            try:
                await self.credential_refresh_task
            except asyncio.CancelledError:
                pass
        
        if self.stream:
            await self.stream.input_stream.close()
        
        if self.response_task and not self.response_task.done():
            self.response_task.cancel()
            try:
                await self.response_task
            except asyncio.CancelledError:
                pass
            
        print("S2S session closed")
