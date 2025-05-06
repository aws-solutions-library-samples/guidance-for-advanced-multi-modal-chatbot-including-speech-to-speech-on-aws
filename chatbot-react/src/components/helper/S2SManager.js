import S2sEvent from './s2sEvents';
import { base64LPCM } from './audioHelper';
import { Auth } from 'aws-amplify';

class S2SManager {
    constructor(options = {}) {
        // Configuration
        this.config = {
            systemPrompt: options.systemPrompt || S2sEvent.DEFAULT_SYSTEM_PROMPT,
            audioOutputConfig: options.audioOutputConfig || S2sEvent.DEFAULT_AUDIO_OUTPUT_CONFIG,
            toolConfig: options.toolConfig || S2sEvent.DEFAULT_TOOL_CONFIG,
            includeChatHistory: options.includeChatHistory || false,
            chatHistory: options.chatHistory || S2sEvent.DEFAULT_CHAT_HISTORY,
            onTranscription: options.onTranscription || (() => {}),
            onUserMessage: options.onUserMessage || (() => {}),  // New callback for completed user transcriptions
            onResponse: options.onResponse || (() => {}),
            onError: options.onError || (() => {}),
            onStateChange: options.onStateChange || (() => {})
        };

        // State
        this.sessionStarted = false;
        this.socket = null;
        this.mediaRecorder = null;
        this.audioPlayerRef = null;
        this.audioQueue = [];
        this.isPlaying = false;
        this.audioPlayPromise = null;
        this.audioChunks = [];
        this.audioInputIndex = 0;
        this.audioResponse = {};
        this.chatMessages = {};
        this.promptName = null;
        this.textContentName = null;
        this.audioContentName = null;
        
        // Response tracking to prevent duplicates
        this.sentResponses = new Set();
    }

    setAudioPlayerRef(ref) {
        this.audioPlayerRef = ref;
    }

    // WebSocket Connection Management
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
            
                this.socket.onopen = () => {
                    console.log('WebSocket connected!', this.socket.url);
                    this.promptName = crypto.randomUUID();
                    this.textContentName = crypto.randomUUID();
                    this.audioContentName = crypto.randomUUID();
        
                    // Start session events
                    this.sendEvent(S2sEvent.sessionStart());

                    const audioConfig = this.config.audioOutputConfig;
                    const toolConfig = this.config.toolConfig;

                    this.sendEvent(S2sEvent.promptStart(this.promptName, audioConfig, toolConfig));
                    this.sendEvent(S2sEvent.contentStartText(this.promptName, this.textContentName));
                    this.sendEvent(S2sEvent.textInput(this.promptName, this.textContentName, this.config.systemPrompt));
                    this.sendEvent(S2sEvent.contentEnd(this.promptName, this.textContentName));

                    // Chat history
                    if (this.config.includeChatHistory) {
                        const chatHistoryContentName = crypto.randomUUID();
                        
                        this.sendEvent(S2sEvent.contentStartText(this.promptName, chatHistoryContentName));
                        
                        const chatHistory = this.config.chatHistory;
                        for (const chat of chatHistory) {
                            this.sendEvent(S2sEvent.textInput(this.promptName, chatHistoryContentName, chat.content, chat.role));
                        }
                        
                        this.sendEvent(S2sEvent.contentEnd(this.promptName, chatHistoryContentName));
                    }

                    this.sendEvent(S2sEvent.contentStartAudio(this.promptName, this.audioContentName));
                };

                // Handle incoming messages
                this.socket.onmessage = (message) => {
                    const event = JSON.parse(message.data);
                    this.handleIncomingMessage(event);
                };
            
                // Handle errors
                this.socket.onerror = (error) => {
                    console.error("WebSocket Error: ", error);
                    this.config.onError("WebSocket Error: " + error);
                };
            
                // Handle connection close
                this.socket.onclose = (event) => {
                    console.log(`WebSocket Disconnected: Code ${event.code}`);
                    
                    // Check for authentication errors (1008 is the code we're using for auth failures)
                    if (event.code === 1008) {
                        this.config.onError("Authentication failed. Please sign in again.");
                    } else if (this.sessionStarted) {
                        this.config.onError("WebSocket Disconnected");
                    }
                };
            } catch (error) {
                console.error("Authentication error:", error);
                this.config.onError("Authentication error: " + error.message);
            }
        }
    }

    sendEvent(event) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(event));
            event.timestamp = Date.now();
        }
    }

    // Audio Processing
    async startMicrophone() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
    
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'interactive'
            });
    
            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(512, 1, 1);
    
            source.connect(processor);
            processor.connect(audioContext.destination);
    
            const targetSampleRate = 16000;
    
            processor.onaudioprocess = async (e) => {
                if (this.sessionStarted) {
                    const inputBuffer = e.inputBuffer;
    
                    // Create an offline context for resampling
                    const offlineContext = new OfflineAudioContext({
                        numberOfChannels: 1,
                        length: Math.ceil(inputBuffer.duration * targetSampleRate),
                        sampleRate: targetSampleRate
                    });
    
                    // Copy input to offline context buffer
                    const offlineSource = offlineContext.createBufferSource();
                    const monoBuffer = offlineContext.createBuffer(1, inputBuffer.length, inputBuffer.sampleRate);
                    monoBuffer.copyToChannel(inputBuffer.getChannelData(0), 0);
    
                    offlineSource.buffer = monoBuffer;
                    offlineSource.connect(offlineContext.destination);
                    offlineSource.start(0);
    
                    // Resample and get the rendered buffer
                    const renderedBuffer = await offlineContext.startRendering();
                    const resampled = renderedBuffer.getChannelData(0);
    
                    // Convert to Int16 PCM
                    const buffer = new ArrayBuffer(resampled.length * 2);
                    const pcmData = new DataView(buffer);
    
                    for (let i = 0; i < resampled.length; i++) {
                        const s = Math.max(-1, Math.min(1, resampled[i]));
                        pcmData.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                    }
    
                    // Convert to binary string and base64 encode
                    let binary = '';
                    for (let i = 0; i < pcmData.byteLength; i++) {
                        binary += String.fromCharCode(pcmData.getUint8(i));
                    }
    
                    const event = S2sEvent.audioInput(
                        this.promptName,
                        this.audioContentName,
                        btoa(binary)
                    );
                    this.sendEvent(event);
                }
            };
    
            window.audioCleanup = () => {
                processor.disconnect();
                source.disconnect();
                stream.getTracks().forEach(track => track.stop());
            };
    
            this.mediaRecorder = new MediaRecorder(stream);
            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };
            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.sendEvent(S2sEvent.audioInput(this.promptName, this.audioContentName, btoa(audioBlob)));
                this.audioChunks = [];
            };
    
            this.mediaRecorder.start();
    
        } catch (error) {
            console.error('Error accessing microphone for S2S:', error);
            this.config.onError('Error accessing microphone: ' + error.message);
        }
    }

    cancelAudio() {
        try {
            if (this.audioPlayerRef && this.audioPlayPromise) {
                this.audioPlayerRef.pause();
                this.audioPlayerRef.currentTime = 0;
                this.audioPlayPromise = null;
            }
            this.audioQueue = [];
            this.isPlaying = false;
        }
        catch(err) {
            console.log(err);
        }
    }

    audioEnqueue(audioUrl) {
        this.audioQueue.push(audioUrl);
        if (!this.isPlaying) {
            this.playNext();
        }
    }

    playNext() {
        try {
            if (this.isPlaying || this.audioQueue.length === 0) return;
        
            if (this.audioPlayerRef && this.audioQueue.length > 0) {
                let audioUrl = this.audioQueue.shift();
                this.isPlaying = true;

                try {
                    this.audioPlayerRef.src = audioUrl;
                    this.audioPlayerRef.load();  // Reload the audio element to apply the new src
                    this.audioPlayPromise = this.audioPlayerRef.play().catch((err) => {
                        console.log("Audio playback error:", err);
                        this.isPlaying = false;
                        // Try next audio after a small delay
                        setTimeout(() => this.playNext(), 100);
                    }); 
                }
                catch(err) {
                    console.log(err);
                    this.isPlaying = false;
                }
                
                // Wait for the audio to finish, then play the next one
                this.audioPlayerRef.onended = () => {
                    this.isPlaying = false;
                    this.playNext();
                };
            }
        }
        catch (error) {
            console.log(error);
            this.isPlaying = false;
        }
    }

    // Event Handling
    handleIncomingMessage(message) {
        const eventType = Object.keys(message?.event)[0];
        const role = message.event[eventType]["role"];
        const content = message.event[eventType]["content"];
        const contentId = message.event[eventType].contentId;
        let stopReason = message.event[eventType].stopReason;
        const contentType = message.event[eventType].type;
        
        // Process incoming event

        switch(eventType) {
            case "textOutput": 
                // Detect interruption
                if (role === "ASSISTANT" && content.startsWith("{")) {
                    const evt = JSON.parse(content);
                    if (evt.interrupted === true) {
                        this.cancelAudio();
                    }
                }

                if (this.chatMessages.hasOwnProperty(contentId)) {
                    this.chatMessages[contentId].content = content;
                    this.chatMessages[contentId].role = role;
                    if (this.chatMessages[contentId].raw === undefined)
                        this.chatMessages[contentId].raw = [];
                    this.chatMessages[contentId].raw.push(message);
                }
                
                // Notify about transcription or response
                if (role === "USER") {
                    this.config.onTranscription(content);
                    
                    // Always add user transcription to chat, regardless of stop reason
                    this.config.onUserMessage(content);
                } else if (role === "ASSISTANT") {
                    // Check if we've already sent this response
                    const responseKey = `${content.substring(0, 50)}`;
                    if (!this.sentResponses.has(responseKey)) {
                        this.sentResponses.add(responseKey);
                        this.config.onResponse(content);
                    }
                }
                break;
                
            case "audioOutput":
                this.audioResponse[contentId] = (this.audioResponse[contentId] || "") + message.event[eventType].content;
                break;
                
            case "contentStart":
                if (contentType === "AUDIO") {
                    this.audioResponse[contentId] = "";
                }
                else if (contentType === "TEXT") {
                    var generationStage = "";
                    if (message.event.contentStart.additionalModelFields) {
                        generationStage = JSON.parse(message.event.contentStart.additionalModelFields)?.generationStage;
                    }

                    this.chatMessages[contentId] = {
                        "content": "", 
                        "role": role,
                        "generationStage": generationStage,
                        "raw": [],
                    };
                    this.chatMessages[contentId].raw.push(message);
                }
                break;
                
            case "contentEnd":
                if (contentType === "AUDIO") {
                    var audioUrl = base64LPCM(this.audioResponse[contentId]);
                    this.audioEnqueue(audioUrl);
                }
                else if (contentType === "TEXT"){
                    if (this.chatMessages.hasOwnProperty(contentId)) {
                        if (this.chatMessages[contentId].raw === undefined)
                            this.chatMessages[contentId].raw = [];
                        this.chatMessages[contentId].raw.push(message);
                        this.chatMessages[contentId].stopReason = stopReason;
                    }
                }
                break;
                
            default:
                break;
        }
    }

    // Session Management
    async startSession() {
        try {
            // Reset state
            this.chatMessages = {};
            this.audioResponse = {};
            this.audioChunks = [];
            this.audioInputIndex = 0;
            this.audioQueue = [];
            this.sentResponses.clear(); // Clear response tracking
            
            // Connect WebSocket
            if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
                await this.connectWebSocket();
            }

            // Start microphone
            this.startMicrophone();
            
            this.sessionStarted = true;
            this.config.onStateChange(true);
        } catch (error) {
            console.error('Error starting S2S session:', error);
            this.config.onError('Error starting S2S session: ' + error.message);
        }
    }

    endSession() {
        if (this.socket) {
            // Close microphone
            if (this.mediaRecorder && this.sessionStarted) {
                this.mediaRecorder.stop();
            }

            // Close S2sSessionManager
            if (this.promptName && this.audioContentName) {
                this.sendEvent(S2sEvent.contentEnd(this.promptName, this.audioContentName));
                this.sendEvent(S2sEvent.promptEnd(this.promptName));
                this.sendEvent(S2sEvent.sessionEnd());
            }

            // Close websocket
            this.socket.close();
            this.socket = null;

            // Clean up audio processing
            if (window.audioCleanup) {
                window.audioCleanup();
            }

            this.sessionStarted = false;
            this.config.onStateChange(false);
        }
    }

    isSessionActive() {
        return this.sessionStarted;
    }
}

export default S2SManager;
