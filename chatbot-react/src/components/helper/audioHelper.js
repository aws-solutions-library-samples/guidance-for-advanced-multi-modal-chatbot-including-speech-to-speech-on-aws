function base64LPCM(base64String) {
    // Decode Base64 string to raw LPCM bytes
    const byteCharacters = atob(base64String);
    const byteArrays = new Uint8Array(byteCharacters.length);
    
    for (let i = 0; i < byteCharacters.length; i++) {
        byteArrays[i] = byteCharacters.charCodeAt(i);
    }

    // Construct WAV header (similar to your Python function)
    const sampleRate = 24000; // 24kHz
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const wavSize = byteArrays.length + 36;
    
    // Create the WAV header
    const wavHeader = new Uint8Array(44);
    const view = new DataView(wavHeader.buffer);

    // RIFF header
    let offset = 0;
    for (let i = 0; i < 4; i++) view.setUint8(offset++, "RIFF".charCodeAt(i));
    view.setUint32(offset, wavSize, true); offset += 4;
    for (let i = 0; i < 4; i++) view.setUint8(offset++, "WAVE".charCodeAt(i));

    // fmt chunk
    for (let i = 0; i < 4; i++) view.setUint8(offset++, "fmt ".charCodeAt(i));
    view.setUint32(offset, 16, true); offset += 4; // Subchunk1Size (16 for PCM)
    view.setUint16(offset, 1, true); offset += 2;  // AudioFormat (1 for PCM)
    view.setUint16(offset, numChannels, true); offset += 2;  // NumChannels
    view.setUint32(offset, sampleRate, true); offset += 4;  // SampleRate
    view.setUint32(offset, byteRate, true); offset += 4;  // ByteRate
    view.setUint16(offset, blockAlign, true); offset += 2;  // BlockAlign
    view.setUint16(offset, bitsPerSample, true); offset += 2;  // BitsPerSample

    // data chunk
    for (let i = 0; i < 4; i++) view.setUint8(offset++, "data".charCodeAt(i));
    view.setUint32(offset, byteArrays.length, true); offset += 4;

    // Combine WAV header and raw audio data
    const wavBlob = new Blob([wavHeader, byteArrays], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(wavBlob);

    return audioUrl;
}

export {base64LPCM };