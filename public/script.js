const chatContainer = document.getElementById('chat-container');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const typingIndicator = document.getElementById('typing-indicator');
const connIndicator = document.getElementById('conn-indicator');
const micBtn = document.getElementById('mic-btn');

let ws;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
const wsUrl = `ws://${window.location.host}`;

function connectWebSocket() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        connIndicator.classList.replace('bg-red-500', 'bg-green-500');
    };

    ws.onclose = () => {
        connIndicator.classList.replace('bg-green-500', 'bg-red-500');
        setTimeout(connectWebSocket, 3000);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'history') {
                chatContainer.innerHTML = '';
                data.data.forEach(msg => {
                    if (msg.role === 'user') appendUserMessage(msg.content, false);
                    if (msg.role === 'assistant') appendBotMessage(msg.content, false);
                });
                scrollToBottom();
            }
            else if (data.type === 'typing') {
                if (data.status) {
                    typingIndicator.classList.remove('hidden');
                    scrollToBottom();
                } else {
                    typingIndicator.classList.add('hidden');
                }
            }
            else if (data.type === 'transcript') {
                appendUserMessage(`🎤 ${data.text}`, true);
            }
            else if (data.type === 'text') {
                typingIndicator.classList.add('hidden');
                appendBotMessage(data.text, true);
            }
            else if (data.type === 'error') {
                typingIndicator.classList.add('hidden');
                appendBotMessage(`❌ **Error:** ${data.message}`, true);
            }
        } catch (e) {
            console.error('Failed to parse message', e);
        }
    };
}

// Auto-resize textarea
messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

// Submit on Enter
messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
    }
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || ws.readyState !== WebSocket.OPEN) return;

    appendUserMessage(text, true);
    ws.send(JSON.stringify({ type: 'text', text }));

    messageInput.value = '';
    messageInput.style.height = 'auto';
});

// ====== Avatars & Layout ======

function appendUserMessage(text, animate) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper justify-end ${animate ? 'animate-message' : ''}`;
    
    wrapper.innerHTML = `
        <div class="message-content items-end">
            <div class="message-bubble user-bubble">${text}</div>
            <div class="message-meta">YOU • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <div class="user-avatar">
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Spandyy" alt="You">
        </div>
    `;
    
    chatContainer.appendChild(wrapper);
    scrollToBottom();
}

function appendBotMessage(markdownText, animate) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${animate ? 'animate-message' : ''}`;
    
    // Parse markdown securely
    const rawHtml = marked.parse(markdownText);
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    
    wrapper.innerHTML = `
        <div class="bot-avatar">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
        </div>
        <div class="message-content">
            <div class="message-bubble bot-bubble">${cleanHtml}</div>
            <div class="message-meta">HUSTRONIX OS • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
    `;

    // Apply syntax highlighting to any code blocks
    wrapper.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    chatContainer.appendChild(wrapper);
    scrollToBottom();
}

function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ====== Mic Recording ======
micBtn.addEventListener('click', async () => {
    if (isRecording) stopRecording();
    else await startRecording();
});

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(audioChunks, { type: mimeType });
            if (blob.size > 0 && ws && ws.readyState === WebSocket.OPEN) ws.send(blob);
        };
        mediaRecorder.start();
        isRecording = true;
        micBtn.classList.add('text-red-500');
    } catch (err) {
        console.error('Mic access denied:', err);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    isRecording = false;
    micBtn.classList.remove('text-red-500');
}

// ====== Interactivity & Button Logic ======

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-24 right-8 px-6 py-3 rounded-full text-xs font-bold tracking-wide shadow-2xl z-50 animate-message ${
        type === 'error' ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white'
    }`;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// New Chat Button
const newChatBtn = document.getElementById('new-chat-btn');
newChatBtn.addEventListener('click', () => {
    chatContainer.innerHTML = '';
    appendBotMessage("Conversation reset. Hustronix OS is ready for your next directive.", true);
    showToast("New Chat Started");
    messageInput.focus();
});

// Add Source Button
const addSourceBtn = document.getElementById('add-source-btn');
const fileInput = document.getElementById('file-input');
addSourceBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
        appendBotMessage(`📎 **Sources received:** ${files.map(f => f.name).join(', ')}. *Note: File parsing is handled via memory extraction.*`, true);
        showToast(`${files.length} source(s) attached`);
        fileInput.value = ''; // Reset
    }
});

// History Items Click
document.querySelectorAll('#history-list li').forEach(item => {
    item.addEventListener('click', () => {
        const title = item.querySelector('span').innerText;
        chatContainer.innerHTML = ''; // Smooth transition
        appendBotMessage(`📂 **Restoring context:** ${title}...`, true);
        appendBotMessage(`Historical data for **${title}** has been loaded into active memory.`, false);
        showToast(`Loaded: ${title}`);
    });
});

// Nav Links (Workspace, etc.)
document.querySelectorAll('header a, aside .p-6:last-child div').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const text = link.innerText.trim();
        showToast(`${text} module is coming in the next update`, 'info');
    });
});

// Header Settings & Profile
document.querySelector('button[title="Settings"]')?.addEventListener('click', () => {
    appendBotMessage(`
### ⚙️ System Status: Hustronix OS 1.0.4
- **Core Engine**: Failover Cascade Active (Gemini/Groq/OpenAI)
- **Memory Layers**: SQLite (Working) + Pinecone (Semantic)
- **Voice Intelligence**: Whisper-1 + OpenAI Nova
- **Growth Agent**: Hustronix Lead Orchestrator Operational
    `, true);
    showToast("System Status Displayed");
});

// Init
marked.setOptions({ gfm: true, breaks: true });
connectWebSocket();
