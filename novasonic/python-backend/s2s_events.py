import json

class S2sEvent:
    """Utility class for creating Nova Sonic S2S events"""
    
    DEFAULT_SYSTEM_PROMPT = "You are a helpful support assistant. The user and you will engage in a spoken dialog exchanging the transcripts of a natural real-time conversation. Keep your responses short, generally two or three sentences for chatty scenarios."
    
    DEFAULT_AUDIO_OUTPUT_CONFIG = {
        "mediaType": "audio/lpcm",
        "sampleRateHertz": 24000,
        "sampleSizeBits": 16,
        "channelCount": 1,
        "voiceId": "matthew",
        "encoding": "base64",
        "audioType": "SPEECH"
    }
    
    DEFAULT_TOOL_CONFIG = [
        {
            "name": "getDateTool",
            "description": "Get the current date and time",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        },
        {
            "name": "getTravelPolicyTool",
            "description": "Get travel policy information",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    ]
    
    DEFAULT_CHAT_HISTORY = [
        {
            "role": "USER",
            "content": "Hello, how are you today?"
        },
        {
            "role": "ASSISTANT",
            "content": "I'm doing well, thank you for asking! How can I help you today?"
        }
    ]
    
    @staticmethod
    def session_start():
        """Create a session start event"""
        return {
            "event": {
                "sessionStart": {
                    "inferenceConfiguration": {
                        "maxTokens": 1024,
                        "topP": 0.9,
                        "temperature": 0.7
                    }
                }
            }
        }
    
    @staticmethod
    def prompt_start(prompt_name, audio_config=None, tool_config=None):
        """Create a prompt start event"""
        if audio_config is None:
            audio_config = S2sEvent.DEFAULT_AUDIO_OUTPUT_CONFIG
            
        event = {
            "event": {
                "promptStart": {
                    "promptName": prompt_name,
                    "textOutputConfiguration": {
                        "mediaType": "text/plain"
                    },
                    "audioOutputConfiguration": audio_config
                }
            }
        }
        
        if tool_config:
            event["event"]["promptStart"]["toolConfiguration"] = {
                "tools": tool_config
            }
            
        return event
    
    @staticmethod
    def content_start_text(prompt_name, content_name):
        """Create a content start event for text"""
        return {
            "event": {
                "contentStart": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "type": "TEXT",
                    "interactive": True,
                    "role": "USER",
                    "textInputConfiguration": {
                        "mediaType": "text/plain"
                    }
                }
            }
        }
    
    @staticmethod
    def content_start_audio(prompt_name, content_name):
        """Create a content start event for audio"""
        return {
            "event": {
                "contentStart": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "type": "AUDIO",
                    "interactive": True,
                    "role": "USER",
                    "audioInputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 16000,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "audioType": "SPEECH",
                        "encoding": "base64"
                    }
                }
            }
        }
    
    @staticmethod
    def content_start_tool(prompt_name, content_name, tool_use_id):
        """Create a content start event for tool use"""
        return {
            "event": {
                "contentStart": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "type": "TOOL",
                    "role": "TOOL",
                    "toolResultInputConfiguration": {
                        "toolUseId": tool_use_id,
                        "type": "TEXT",
                        "textInputConfiguration": {
                            "mediaType": "text/plain"
                        }
                    }
                }
            }
        }
    
    @staticmethod
    def text_input(prompt_name, content_name, text, role="USER"):
        """Create a text input event"""
        return {
            "event": {
                "textInput": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "content": text,
                    "role": role
                }
            }
        }
    
    @staticmethod
    def text_input_tool(prompt_name, content_name, text):
        """Create a tool result event"""
        return {
            "event": {
                "toolResult": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "content": text
                }
            }
        }
    
    @staticmethod
    def audio_input(prompt_name, content_name, audio_base64):
        """Create an audio input event"""
        return {
            "event": {
                "audioInput": {
                    "promptName": prompt_name,
                    "contentName": content_name,
                    "content": audio_base64,
                    "role": "USER"
                }
            }
        }
    
    @staticmethod
    def content_end(prompt_name, content_name):
        """Create a content end event"""
        return {
            "event": {
                "contentEnd": {
                    "promptName": prompt_name,
                    "contentName": content_name
                }
            }
        }
    
    @staticmethod
    def prompt_end(prompt_name):
        """Create a prompt end event"""
        return {
            "event": {
                "promptEnd": {
                    "promptName": prompt_name
                }
            }
        }
    
    @staticmethod
    def session_end():
        """Create a session end event"""
        return {
            "event": {
                "sessionEnd": {}
            }
        }