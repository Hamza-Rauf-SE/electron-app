# Complete Features Guide

This app provides two powerful AI-powered modes to help you in different scenarios: **Realtime Session** for live conversations and **Chat Mode** for quick questions with screenshots.

---

## 🎙️ Feature 1: Realtime Session (Live Mode)

The Realtime Session is a live, continuous WebSocket connection with Google Gemini 2.0 Flash Live that provides real-time assistance during interviews, meetings, calls, and presentations.

### What It Does

**Realtime Session creates a live AI assistant that:**

-   🎧 Listens to your system audio and microphone simultaneously
-   👥 Identifies different speakers (Interviewer vs You)
-   💬 Accepts text messages from you during the session
-   📸 Captures manual screenshots when you need visual context
-   🔍 Searches Google for current information (optional)
-   📝 Provides instant text responses in real-time
-   💾 Saves conversation history automatically

### Technology Stack

| Component           | Technology                                                         |
| ------------------- | ------------------------------------------------------------------ |
| **API**             | Google Gemini Live 2.0 (WebSocket - `bidiGenerateContent`)         |
| **Model**           | `gemini-2.0-flash-exp`                                             |
| **Connection**      | Persistent WebSocket (stays open during session)                   |
| **Audio Capture**   | SystemAudioDump (macOS), Loopback (Windows), Display Media (Linux) |
| **Audio Format**    | PCM 24kHz mono, streamed in 0.1s chunks                            |
| **Response Format** | Text only (no audio output)                                        |
| **Transcription**   | Real-time with speaker diarization                                 |

### Key Features

#### 1. **Dual Audio Capture**

-   **System Audio**: Captures what you hear (interview questions, meeting discussions)
-   **Microphone**: Captures what you say (your responses)
-   **Smart Processing**: Converts stereo to mono, chunks audio into 0.1s segments
-   **Platform Support**:
    -   macOS: SystemAudioDump binary
    -   Windows: Loopback audio
    -   Linux: Display media API

#### 2. **Speaker Diarization**

Automatically identifies and labels speakers:

```
[Interviewer]: What is your experience with React?
[Candidate]: I have 3 years of experience...
```

-   **Min Speakers**: 2
-   **Max Speakers**: 2
-   **Labels**: Interviewer (Speaker 1) and Candidate (Speaker 2)

#### 3. **Text Input During Session**

While audio is being captured, you can also:

-   Type questions to the AI
-   Ask for clarification
-   Request specific help
-   Get immediate text responses

**Example:**

```
You type: "Give me a detailed answer about React hooks"
AI responds: [Detailed explanation appears in the assistant view]
```

#### 4. **Manual Screenshot Capture**

Press the "Ask Next Step" keyboard shortcut to:

-   Capture current screen
-   Send to AI with automatic prompt
-   Get help with visible content
-   Useful for code reviews, UI questions, document analysis

**Features:**

-   JPEG compression (85% quality, ~90% smaller than PNG)
-   Silent capture (no OS indicators after first permission)
-   Memory cleared immediately after sending
-   No temporary files on disk

#### 5. **Google Search Integration**

AI can search Google in real-time for:

-   Current events and news
-   Technical documentation
-   Company information
-   Market data
-   Any time-sensitive information

**Toggle in Settings:**

-   Enable/Disable Google Search
-   When enabled: AI can search automatically when needed
-   When disabled: AI relies only on training data

#### 6. **Multiple Profiles**

Choose AI behavior based on your scenario:

| Profile              | Best For        | AI Behavior                                  |
| -------------------- | --------------- | -------------------------------------------- |
| **Interview**        | Job interviews  | Provides concise, ready-to-speak answers     |
| **Sales Call**       | Sales pitches   | Focuses on persuasion and objection handling |
| **Business Meeting** | Team meetings   | Professional, collaborative tone             |
| **Presentation**     | Public speaking | Helps with slides and audience questions     |
| **Negotiation**      | Contract talks  | Strategic, balanced responses                |
| **Exam Assistant**   | Tests/Exams     | Quick, accurate answers                      |

#### 7. **Response History & Navigation**

-   **Automatic Saving**: Every AI response is saved
-   **Navigate Responses**: Use arrow buttons or keyboard shortcuts
-   **Response Counter**: Shows "3/15" (current/total)
-   **Scroll Control**: Keyboard shortcuts to scroll long responses
-   **History View**: Access all past conversations

**Keyboard Shortcuts:**

-   `Previous Response`: Navigate to previous AI answer
-   `Next Response`: Navigate to next AI answer
-   `Scroll Up/Down`: Scroll through long responses

#### 8. **Session Management**

-   **Conversation Tracking**: Each session gets a unique ID
-   **Turn-by-Turn Storage**: Stores user input + AI response pairs
-   **IndexedDB Storage**: Saved locally in browser
-   **Auto-Reconnection**: Attempts to reconnect if connection drops (max 3 attempts)
-   **Context Preservation**: Reconnection includes conversation history

### How Realtime Session Works

```
┌─────────────────────────────────────────────────────────────┐
│                    User Starts Session                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│          Initialize WebSocket Connection                     │
│          Model: gemini-2.0-flash-exp                        │
│          Enable: Speaker Diarization, Google Search          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Start Audio Capture                             │
│   ┌─────────────────────┬─────────────────────┐            │
│   │   System Audio      │   Microphone        │            │
│   │   (What you hear)   │   (What you say)    │            │
│   └──────────┬──────────┴──────────┬──────────┘            │
│              │                      │                        │
│              ▼                      ▼                        │
│         Convert to Mono         Convert to Mono             │
│         24kHz PCM               24kHz PCM                   │
│              │                      │                        │
│              ▼                      ▼                        │
│         Chunk (0.1s)            Chunk (0.1s)                │
│              │                      │                        │
│              └──────────┬───────────┘                        │
│                         │                                    │
│                         ▼                                    │
│              Stream to Gemini Live                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                 AI Processing                                │
│   • Transcribes audio with speaker labels                   │
│   • Analyzes conversation context                           │
│   • Searches Google if needed                               │
│   • Generates text response                                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Display Response                                │
│   • Word-by-word animation                                  │
│   • Markdown formatting                                     │
│   • Syntax highlighting for code                            │
│   • Save to history                                         │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
              Continuous Loop
        (Audio streams until session ends)
```

### Input Methods in Realtime Session

1. **Audio Input** (Continuous)

    - System audio captured automatically
    - Microphone captured automatically
    - Streamed in real-time

2. **Text Input** (On-Demand)

    - Type in the text input box
    - Press Enter or click Send
    - AI responds immediately

3. **Screenshot Input** (Manual)
    - Press "Ask Next Step" shortcut
    - Screenshot captured silently
    - Sent with automatic prompt
    - AI analyzes and responds

### Use Cases

#### Perfect For:

✅ **Job Interviews** - Get instant answer suggestions
✅ **Sales Calls** - Handle objections in real-time
✅ **Business Meetings** - Quick facts and data
✅ **Presentations** - Answer audience questions
✅ **Live Demos** - Technical support during demos
✅ **Customer Support Calls** - Find solutions quickly
✅ **Negotiations** - Strategic response suggestions

#### Not Ideal For:

❌ Quick one-off questions (use Chat Mode instead)
❌ Heavy screenshot analysis (use Chat Mode)
❌ When audio is not available
❌ Asynchronous communication

### Performance & Costs

**Token Usage (Approximate):**

-   Audio: ~32 tokens per second
-   Text message: ~1 token per word
-   Screenshot: ~258-2000 tokens (depends on resolution)
-   Average 1-hour interview: ~115,000 tokens

**Resource Usage:**

-   CPU: 3-5% (audio processing)
-   Memory: 50-100MB (audio buffers + UI)
-   Network: Continuous WebSocket (variable bandwidth)

---

## 💬 Feature 2: Chat Mode (Question & Screenshot)

Chat Mode is a simple, REST API-based chat interface perfect for asking questions with optional screenshot context. No continuous connection, no audio - just text and images.

### What It Does

**Chat Mode provides:**

-   💬 Traditional chat interface (like ChatGPT)
-   📸 Manual screenshot capture with preview
-   🖼️ Image attachment before sending
-   📜 Persistent chat history
-   ⚡ Fast responses without WebSocket overhead
-   🔒 Maximum stealth (no continuous audio capture)
-   💰 Lower token costs (pay per message only)

### Technology Stack

| Component      | Technology                                            |
| -------------- | ----------------------------------------------------- |
| **API**        | Google Gemini Standard API (REST - `generateContent`) |
| **Model**      | `gemini-2.0-flash-exp`                                |
| **Connection** | Single HTTP request per message                       |
| **Input**      | Text + Optional JPEG image                            |
| **Response**   | Text (markdown formatted)                             |
| **Storage**    | In-memory array (cleared on restart)                  |

### Key Features

#### 1. **Chat Interface**

Clean, modern chat UI with:

-   **Message Bubbles**: User (blue) and AI (green)
-   **Timestamps**: Shows when each message was sent
-   **Markdown Rendering**: Full markdown support for AI responses
-   **Syntax Highlighting**: Code blocks are highlighted
-   **Scrollable History**: All messages in one view
-   **Text Selection**: Can copy text from any message

#### 2. **Screenshot Integration**

Seamless screenshot workflow:

```
Click Camera Icon → Screenshot Captured → Preview Shows → Edit Message → Send
```

**Features:**

-   **Silent Capture**: No OS indicators (after first permission)
-   **JPEG Compression**: 85% quality, ~90% smaller than PNG
-   **Preview & Remove**: See preview, remove if not needed
-   **No Disk Storage**: Screenshot only in memory
-   **Auto-Clear**: Memory cleared after sending

**Screenshot Capture:**

```javascript
// Click camera button
→ Captures entire screen
→ Converts to JPEG (85% quality)
→ Shows preview thumbnail
→ Attaches to message
→ Sends when you click Send
→ Memory cleared immediately
```

#### 3. **Message Input**

Flexible input options:

-   **Text Input**: Multi-line textarea with resize
-   **Keyboard Shortcut**: `Ctrl/Cmd + Enter` to send
-   **Screenshot Attachment**: Optional image with every message
-   **Empty Message**: Can send screenshot only (auto-prompt)

**Message Types:**

1. **Text Only**: Type question, no screenshot
2. **Text + Screenshot**: Screenshot with your question
3. **Screenshot Only**: Just screenshot (AI analyzes it)

#### 4. **Chat History**

-   **In-Memory Storage**: Persists during app session
-   **Clear History**: Button to clear all messages
-   **Message Navigation**: Scroll through past conversations
-   **Timestamp**: Each message shows send time
-   **Image Indicators**: Shows 📷 when message has screenshot

#### 5. **Response Formatting**

AI responses support:

-   **Markdown**: Headers, bold, italic, lists
-   **Code Blocks**: With syntax highlighting
-   **Tables**: Formatted tables
-   **Links**: Clickable links
-   **Blockquotes**: Styled quotes
-   **Lists**: Ordered and unordered

#### 6. **Loading States**

-   **Loading Indicator**: Shows "Gemini is thinking..."
-   **Animated Dots**: Pulsing animation
-   **Disabled Controls**: Can't send while loading
-   **Smooth Transitions**: Fade-in animations

### How Chat Mode Works

```
┌─────────────────────────────────────────────────────────────┐
│                    User Opens Chat                           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│          Initialize Chat (No Connection Yet)                 │
│          Model: gemini-2.0-flash-exp                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              User Composes Message                           │
│   ┌─────────────────────────────────────────┐              │
│   │  Optional: Click Camera Icon            │              │
│   │  → Capture Screenshot                   │              │
│   │  → Show Preview                         │              │
│   │  → User can remove if needed            │              │
│   └─────────────────┬───────────────────────┘              │
│                     │                                        │
│                     ▼                                        │
│   ┌─────────────────────────────────────────┐              │
│   │  Type Message in Text Box               │              │
│   │  (Optional - can send screenshot only)  │              │
│   └─────────────────┬───────────────────────┘              │
└─────────────────────┴───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Press Send Button                               │
│              (or Ctrl/Cmd + Enter)                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│          Build API Request                                   │
│   • Message text (if provided)                              │
│   • Base64 JPEG image (if screenshot attached)              │
│   • User role: "user"                                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│          Send HTTP POST to Gemini API                       │
│          Endpoint: generateContent                           │
│          Wait for response...                                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                 AI Processes Request                         │
│   • Analyzes text prompt                                    │
│   • Analyzes screenshot (if attached)                       │
│   • Generates comprehensive response                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Display Response                                │
│   • Add user message to chat history                        │
│   • Add AI response to chat history                         │
│   • Render markdown                                         │
│   • Clear screenshot from memory                            │
│   • Clear input box                                         │
│   • Scroll to bottom                                        │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
                Ready for Next Message
        (No persistent connection, repeat as needed)
```

### Chat Mode Advantages

#### ✅ Benefits Over Realtime Session

1. **Lower Cost**

    - Pay only for messages sent
    - No continuous audio streaming
    - Typical conversation: 1,000-5,000 tokens vs 115,000+

2. **Better Control**

    - You decide exactly when to ask
    - Review screenshot before sending
    - Edit message before submitting

3. **Maximum Stealth**

    - No continuous audio capture
    - No background processing
    - Silent screenshot capture only when you click

4. **Simpler Interface**

    - Traditional chat layout
    - Easy to understand
    - Quick to use

5. **Visual Context**

    - Screenshot preview before sending
    - See exactly what AI will analyze
    - Can remove and retake if needed

6. **Better for Async**
    - No need for live conversation
    - Ask question when you're ready
    - Take your time composing

### Use Cases

#### Perfect For:

✅ **Code Questions** - Screenshot code, ask for help
✅ **UI/Design Reviews** - Show interface, get feedback
✅ **Document Analysis** - Screenshot text, ask questions
✅ **Error Debugging** - Capture error, get solution
✅ **Quick Help** - One-off questions with context
✅ **Research** - Ask questions without audio
✅ **Exam Help** - Screenshot question, get answer
✅ **Tutorial Following** - Capture steps, ask for clarification

#### Not Ideal For:

❌ Live conversations (use Realtime Session)
❌ Continuous assistance during calls
❌ Speaker-specific responses
❌ Real-time audio analysis

### Performance & Costs

**Token Usage (Approximate):**

-   Text message: ~1 token per word
-   Screenshot: ~258-2000 tokens (depends on resolution)
-   Average question with screenshot: ~300-500 tokens
-   10 messages with screenshots: ~3,000-5,000 tokens

**Comparison:**

```
Chat Mode (10 messages):      ~5,000 tokens    💰
Realtime Session (1 hour):   ~115,000 tokens   💰💰💰

Savings: 95%+ 🎉
```

**Resource Usage:**

-   CPU: <1% (only during API call)
-   Memory: 10-20MB (single screenshot + UI)
-   Network: Only when sending message

---

---

## 🧠 Feature 3: OpenAI Realtime Session

The OpenAI Realtime Session offers a powerful alternative for live assistance, leveraging OpenAI's latest real-time and reasoning models. It is particularly effective for complex technical tasks and coding scenarios.

### What It Does

**OpenAI Realtime Session provides:**

-   🎧 Continuous dual-stream audio capture (System + Mic)
-   ⚡ Low-latency WebSocket connection
-   📸 Advanced screenshot analysis using **GPT-5.1 Codex Max**
-   💬 Instant text responses (non-streaming)
-   🧠 Specialized capabilities for code and technical analysis

### Technology Stack

| Component           | Technology                                                         |
| ------------------- | ------------------------------------------------------------------ |
| **API**             | OpenAI Realtime API (WebSocket)                                    |
| **Conversation Model**| `gpt-realtime`                                                   |
| **Screenshot Model**| `gpt-5.1-codex-max`                                                |
| **Connection**      | Persistent WebSocket                                               |
| **Audio Format**    | PCM 24kHz mono                                                     |

### Key Features

#### 1. **Advanced Screenshot Analysis**
Screenshots in this mode are processed by `gpt-5.1-codex-max`, a model highly optimized for:
-   Code review and debugging
-   Extracting text and data structures
-   Analyzing complex UI elements
-   Technical documentation reading

#### 2. **Instant "Direct" Display**
Responses in OpenAI mode are displayed instantly upon completion rather than streaming word-by-word, allowing for quicker reading of complete thoughts and code blocks.

#### 3. **Seamless Audio Integration**
Uses the same robust `SystemAudioDump` (macOS) architecture to capture meeting audio and interviews with high fidelity, resampled specifically for OpenAI's 24kHz requirement.

---

## 🔄 Feature Comparison

| Feature            | Gemini Session         | OpenAI Session         | Chat Mode              |
| ------------------ | ---------------------- | ---------------------- | ---------------------- |
| **Connection**     | WebSocket (persistent) | WebSocket (persistent) | REST API (per message) |
| **Audio Capture**  | ✅ Continuous          | ✅ Continuous          | ❌ No audio            |
| **Text Input**     | ✅ During session      | ✅ During session      | ✅ Primary input       |
| **Screenshot**     | ✅ Manual (shortcut)   | ✅ Manual (Codex)      | ✅ Manual (button)     |
| **Speaker Labels** | ✅ Yes (diarization)   | ✅ Server VAD          | ❌ N/A                 |
| **Google Search**  | ✅ Real-time           | ❌ No                  | ❌ No                  |
| **Response Speed** | ⚡ Instant (Stream)    | ⚡ Instant (Direct)    | ⚡ 2-5 seconds         |
| **Cost (1 hour)**  | ~115K tokens           | ~100K tokens           | ~5K tokens             |
| **Best For**       | Live conversations     | Coding / Technical     | Quick questions        |
| **Stealth Level**  | Medium                 | Medium                 | Maximum                |
| **History**        | ✅ Saved automatically | ✅ Saved automatically | ✅ In-memory           |
| **Profiles**       | ✅ 6 profiles          | ✅ 6 profiles          | ❌ No profiles         |
| **Reconnection**   | ✅ Auto (3 attempts)   | ✅ Auto                | ❌ Not needed          |

---

## 🎯 Choosing the Right Mode

### Use Realtime Session When:

-   🎤 You're in a live conversation (interview, meeting, call)
-   👥 Multiple speakers need to be identified
-   ⚡ You need instant responses during dialogue
-   🔍 Google Search integration is important
-   📝 You want conversation history saved automatically
-   🎯 Using specific profile behaviors (interview, sales, etc.)

### Use Chat Mode When:

-   📸 You need to analyze something on screen
-   💰 Cost is a concern (much cheaper)
-   🔒 Maximum stealth is required
-   ⏱️ You have time to compose questions
-   🖼️ Visual context is more important than audio
-   📝 You want to review before sending
-   ❓ One-off questions without ongoing conversation

---

## 🚀 Getting Started

### For Realtime Session:

1. Enter your Gemini API key
2. (Optional) Choose a profile in Customize
3. (Optional) Enable Google Search
4. Click "**Start Session**"
5. Audio captures automatically
6. Type messages or press shortcuts as needed
7. Click "Close Session" when done

### For Chat Mode:

1. Enter your Gemini API key
2. Click "**💬 Start Chat**"
3. Type your question
4. (Optional) Click camera icon for screenshot
5. Press Send or Ctrl/Cmd + Enter
6. Get instant response
7. Repeat as needed

---

## 🔧 Advanced Features

### Both Modes Support:

-   ✅ **Stealth Mode**: Hidden dock icon, random process name
-   ✅ **Background Mode**: Run via `nohup` (see BACKGROUND_MODE.md)
-   ✅ **Keyboard Shortcuts**: Customizable in settings
-   ✅ **Content Protection**: Prevents external screenshots of app
-   ✅ **Window Controls**: Always on top, click-through mode
-   ✅ **Theme**: Dark mode with transparency
-   ✅ **Export**: Copy responses (text selection enabled)

### Realtime-Only Features:

-   🎙️ Audio transcription with speaker labels
-   🔄 Auto-reconnection with context preservation
-   📊 Profile-based AI behavior
-   🌐 Real-time Google Search
-   📈 Token tracking and rate limiting

### Chat-Only Features:

-   🖼️ Screenshot preview before sending
-   🗑️ Clear chat history
-   💬 Traditional chat interface
-   📷 Image indicator in messages
-   ⏱️ Message timestamps

---

## 💡 Pro Tips

### Realtime Session Tips:

1. **Set up audio first** - Test audio permissions before important calls
2. **Use profiles** - Choose the right profile for better responses
3. **Keep text handy** - Type questions when audio isn't enough
4. **Manual screenshots** - Use shortcuts for visual context
5. **Review history** - Navigate responses with arrow shortcuts
6. **Monitor costs** - Long sessions use more tokens

### Chat Mode Tips:

1. **Preview screenshots** - Always check before sending
2. **Be specific** - Detailed questions get better answers
3. **Combine text + image** - Give AI both visual and textual context
4. **Clear when done** - Clear history to save memory
5. **Use for async** - Perfect when not in live conversation
6. **Screenshot selectively** - Only capture what AI needs to see

---

## 📊 Technical Specifications

### Realtime Session

```yaml
API: Gemini Live API (WebSocket)
Model: gemini-2.0-flash-exp
Audio Format: PCM 24kHz mono
Chunk Size: 0.1 seconds
Speaker Detection: 2 speakers (min/max)
Response: Text only
Tools: Google Search (optional)
Compression: Sliding window context
Language: Configurable (30+ languages)
```

### Chat Mode

```yaml
API: Gemini Standard API (REST)
Model: gemini-2.0-flash-exp
Image Format: JPEG 85% quality
Max Image Size: 1920x1080
Response: Text (markdown)
History: In-memory (session-only)
Storage: No persistent storage
```

---

## 🛡️ Privacy & Security

### Data Handling:

-   ✅ **API Key**: Stored in localStorage (encrypted by OS)
-   ✅ **Audio**: Streamed directly to API, not stored locally
-   ✅ **Screenshots**: Memory only, cleared after sending
-   ✅ **Conversations**: Stored in IndexedDB (local only)
-   ✅ **No Cloud Storage**: Everything local except API calls
-   ✅ **No Telemetry**: App doesn't track or report usage

### Stealth Features:

-   ✅ Hidden dock icon (macOS)
-   ✅ Random process names
-   ✅ Content protection enabled
-   ✅ Skip taskbar (Windows/Linux)
-   ✅ Hidden from Mission Control (macOS)
-   ✅ Silent screenshot capture
-   ✅ No console logs in production

---

## 📖 Related Documentation

-   **BACKGROUND_MODE.md** - Run app in background with nohup
-   **README.md** - General setup and usage
-   **AGENTS.md** - AI behavior and prompt engineering

---

## ❓ FAQ

**Q: Can I use both modes in the same session?**
A: No, you must close one before starting the other. They use different API endpoints.

**Q: Which mode is more expensive?**
A: Realtime Session uses ~95% more tokens due to continuous audio streaming.

**Q: Can Chat Mode do audio transcription?**
A: No, Chat Mode is text + image only. Use Realtime Session for audio.

**Q: Can Realtime Session accept screenshots?**
A: Yes! Use the "Ask Next Step" keyboard shortcut during the session.

**Q: Is my data stored in the cloud?**
A: Only during API calls to Gemini. Local storage is browser-based (IndexedDB).

**Q: Can I export conversations?**
A: Yes, text is selectable. You can copy and paste responses.

**Q: Which mode is more stealthy?**
A: Chat Mode - no continuous audio capture, manual screenshots only.

**Q: Can I use offline?**
A: No, both modes require internet connection to Gemini API.

---

## 🎉 Summary

**Gemini Realtime Session** = Live AI assistant for conversations (audio + text + screenshots)
**OpenAI Realtime Session** = Specialized live assistant for coding & technical tasks (audio + text + Codex screenshots)
**Chat Mode** = Quick Q&A with visual context (text + screenshots)

These modes use cutting-edge AI technology to provide intelligent, context-aware assistance when you need it most!
