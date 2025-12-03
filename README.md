# ODAM Memory for Cursor

Long-term memory extension for Cursor AI assistant powered by ODAM.

## Features

- 🧠 **Long-term Memory**: Persistent memory across sessions
- 🔄 **Automatic Sync**: Automatically saves and retrieves context
- 📝 **Code Artifacts**: Tracks code changes and artifacts
- 🔍 **Context Injection**: Injects relevant memory into chat context
- 📊 **Memory Analytics**: View memory statistics and usage

## Installation

### From VSIX File

1. Download the latest `.vsix` file from [Releases](../../releases/)
2. Open Cursor
3. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
4. Type: `Extensions: Install from VSIX...`
5. Select the downloaded `.vsix` file

### From Source

```bash
git clone https://github.com/aipsyhelp/Cursor_ODAM.git
cd Cursor_ODAM/github-release
npm install
npm run compile
npm run package
```

Then install the generated `.vsix` file.

## Configuration

### Getting Your API Key

To use this extension, you'll need an ODAM API key. As developers, you can request a test API key from us:

📧 **Email**: [ai@psyhelp.info](mailto:ai@psyhelp.info)

We're happy to provide you with an API key for testing our extension. Please include:
- Your name and organization
- Brief description of your use case
- Expected testing duration

Once you receive your API key, follow the configuration steps below.

### Configuration Steps

1. Open Cursor Settings (`Cmd+,` or `Ctrl+,`)
2. Search for "ODAM"
3. Configure:
   - `odam.enabled`: Enable/disable the extension
   - `odam.apiUrl`: ODAM API URL (default: `https://api.odam.dev`)
   - `odam.apiKey`: Your ODAM API key (required - see "Getting Your API Key" above)
   - `odam.userId`: User ID (auto-generated if empty)

### Quick Setup via Command Palette

1. Press `Cmd+Shift+P` / `Ctrl+Shift+P`
2. Type: `ODAM: Configure Memory`
3. Enter your API key

## Usage

### Basic Usage

Once configured, the extension works automatically:

1. **Chat with Cursor**: Your queries and responses are automatically saved to ODAM
2. **Memory Context**: Relevant memory is automatically injected into chat context
3. **Code Tracking**: Code changes are tracked and saved as artifacts

### Commands

- `ODAM: Show Memory` - View current memory statistics
- `ODAM: Show Context Logs` - View context flow logs
- `ODAM: View Data in ODAM` - View data stored in ODAM
- `ODAM: Reset Project Memory` - Clear project memory
- `ODAM: Configure Memory` - Configure extension settings

### Verifying Hooks

- Confirm that `~/.cursor/hooks.json` contains entries for `odam-before.sh`, `odam-after.sh`, and `odam-thought.sh`
- Make sure `~/.cursor/bin/cursor-odam-hook` exists and is executable
- Inspect `~/.cursor/odam-hook-config.json` to see the local Hook Event Server port

## How It Works

1. **Cursor Hooks**: Official `beforeSubmitPrompt`, `afterAgentResponse`, `afterAgentThought` hooks call `cursor-odam-hook` (auto-installed to `~/.cursor/hooks/odam-*.sh`)
2. **Hook Event Server**: The extension runs a local secure HTTP server that accepts hook events in real time
3. **Save Interactions**: User queries and AI responses are saved to ODAM via `/api/v1/code-memory/record`
4. **Retrieve Context**: Relevant memory is retrieved via `/api/v1/code-memory/context`
5. **Inject Context**: Memory context is injected into `.cursor/rules/odam-memory.mdc`
6. **Cursor Uses Context**: Cursor automatically reads the memory file and uses it in chat

> **Note:** The hook scripts (`~/.cursor/hooks/odam-before.sh`, `...-after.sh`, `...-thought.sh`) and global hooks configuration (`~/.cursor/hooks.json`) are created or updated automatically when the extension is activated. If you already have custom hooks, the ODAM entries are appended without removing existing ones.

## Architecture

### System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cursor IDE                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Chat UI    │  │  Code Editor │  │  File System Events   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                  │                     │              │
│         └──────────────────┼─────────────────────┘              │
│                            │                                    │
│                            ▼                                    │
│              ┌─────────────────────────────┐                    │
│              │  ODAM Extension (Cursor)     │                    │
│              │  ┌────────────────────────┐ │                    │
│              │  │ Hook Event Processor   │ │                    │
│              │  │ - beforeSubmitPrompt   │ │                    │
│              │  │ - afterAgentResponse   │ │                    │
│              │  │ - afterAgentThought    │ │                    │
│              │  └───────────┬────────────┘ │                    │
│              │              │               │                    │
│              │  ┌───────────▼────────────┐ │                    │
│              │  │ Memory File Updater    │ │                    │
│              │  │ - Updates .mdc file    │ │                    │
│              │  │ - Fetches context      │ │                    │
│              │  └───────────┬────────────┘ │                    │
│              │              │               │                    │
│              │  ┌───────────▼────────────┐ │                    │
│              │  │ Code Artifact Tracker  │ │                    │
│              │  │ - Monitors changes     │ │                    │
│              │  │ - Extracts entities    │ │                    │
│              │  └───────────┬────────────┘ │                    │
│              │              │               │                    │
│              │  ┌───────────▼────────────┐ │                    │
│              │  │ Project Knowledge      │ │                    │
│              │  │ Indexer               │ │                    │
│              │  │ - Indexes docs        │ │                    │
│              │  └───────────┬────────────┘ │                    │
│              └──────────────┼───────────────┘                    │
│                             │                                    │
└─────────────────────────────┼──────────────────────────────────┘
                               │ HTTPS/REST API
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ODAM API Server                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Code Memory API                                          │  │
│  │  POST /api/v1/code-memory/record                         │  │
│  │  POST /api/v1/code-memory/context                        │  │
│  └───────────────┬───────────────────────────┬───────────────┘  │
│                  │                           │                  │
│         ┌────────▼────────┐         ┌────────▼────────┐         │
│         │ Semantic Analysis│         │ Context Builder │         │
│         │ - LLM Processing│         │ - Memory Search │         │
│         │ - Entity Extract│         │ - Graph Traverse│         │
│         │ - Relationship  │         │ - Filter Errors │         │
│         │   Detection     │         │ - Rank Results  │         │
│         └────────┬────────┘         └────────┬────────┘         │
│                  │                           │                  │
└──────────────────┼───────────────────────────┼──────────────────┘
                   │                           │
         ┌─────────▼──────────┐    ┌───────────▼──────────┐
         │   Data Storage     │    │   Knowledge Graph     │
         │                    │    │                       │
         │  ┌──────────────┐  │    │  ┌─────────────────┐ │
         │  │  ChromaDB    │  │    │  │     Neo4j        │ │
         │  │  (Vectors)   │  │    │  │  (Relationships) │ │
         │  │  Embeddings  │  │    │  │  Entity Graph    │ │
         │  └──────────────┘  │    │  └─────────────────┘ │
         │                    │    │                       │
         │  ┌──────────────┐  │    │                       │
         │  │  Cosmos DB   │  │    │                       │
         │  │  (Documents) │  │    │                       │
         │  │  Episodic    │  │    │                       │
         │  │  Semantic    │  │    │                       │
         │  └──────────────┘  │    │                       │
         └────────────────────┘    └───────────────────────┘
```

### ODAM Semantic Analysis & Knowledge Graph

ODAM performs advanced semantic analysis to build a comprehensive knowledge graph:

#### 1. **Semantic Analysis Pipeline**
- **Text Processing**: Natural language understanding using LLM (GPT-4o-mini)
- **Entity Extraction**: Identifies entities (Person, Technology, Project, Language, Tool, Library, Framework, Preference, Error, Solution, Approach, Pattern, Code Style)
- **Relationship Detection**: Discovers connections between entities (uses, depends_on, implements, fixes, causes)
- **Embedding Generation**: Converts text to high-dimensional vectors (768+ dimensions) for semantic similarity search

#### 2. **Vector Storage (ChromaDB)**
- **Embeddings**: All text (queries, responses, code, documentation) is converted to embeddings
- **Semantic Search**: Fast similarity search using cosine distance
- **Multi-Modal**: Supports code, natural language, and structured data
- **Privacy**: User data is isolated per `user_id` and `session_id`

#### 3. **Knowledge Graph (Neo4j)**
- **Entity Nodes**: Represents extracted entities with properties (name, type, confidence, metadata)
- **Relationships**: Connects entities with typed edges (RELATES_TO, CONTAINS, IMPLEMENTS, FIXES)
- **Graph Traversal**: Finds related entities through graph queries
- **Dynamic Entities**: Entities evolve over time as new information is added

#### 4. **Intelligent Context Filtering**

ODAM intelligently filters memory context to provide only relevant and useful information:

- **✅ Proven Solutions**: Only successful approaches (`status: success`, `test_status: passed`) are prioritized
- **⚠️ Known Issues**: Failed approaches (`status: failed`, `outcome: regression`) are marked and excluded from positive context, but included in warnings
- **🔍 Relevance Ranking**: Context is ranked by semantic similarity to the current query
- **📊 Confidence Scoring**: Only high-confidence entities (`confidence > 0.7`) are included
- **🔄 Temporal Filtering**: Recent successful solutions are prioritized over older ones

#### 5. **Data Security & Privacy**

- **Encrypted Storage**: All data is encrypted at rest (AES-256)
- **HTTPS Only**: All API communication uses TLS 1.3
- **User Isolation**: Data is strictly isolated per user (`user_id`) and project (`session_id`)
- **No Data Sharing**: User data is never shared between users or projects
- **API Key Authentication**: Secure API key-based authentication
- **Audit Logging**: All data access is logged for security compliance

#### 6. **Memory Types**

ODAM stores multiple types of memory:

- **Episodic Memory**: Specific conversations and events (timestamped)
- **Semantic Memory**: Facts about the user and project (persistent)
- **Procedural Memory**: Code patterns and solutions (reusable)
- **Emotional Memory**: User preferences and style (personalized)

### Benefits of ODAM's Approach

1. **Semantic Understanding**: Unlike keyword-based search, ODAM understands meaning and context
2. **Long-Term Memory**: Remembers project history, user preferences, and successful solutions
3. **Error Prevention**: Automatically avoids repeating past mistakes
4. **Context Awareness**: Provides relevant context based on semantic similarity, not just keywords
5. **Scalability**: Vector search scales to millions of memories efficiently
6. **Privacy**: User data is encrypted and isolated
7. **Intelligence**: Learns from past interactions to improve future responses

## Development

### Prerequisites

- Node.js 18+
- TypeScript 5.0+
- VS Code / Cursor IDE

### Setup

```bash
npm install
npm run compile
```

### Build

```bash
npm run package
```

### Development Mode

1. Open project in VS Code/Cursor
2. Press `F5` to launch Extension Development Host
3. Test your changes in the new window

## API Endpoints

The extension uses the following ODAM API endpoints:

- `POST /api/v1/code-memory/record` - Save interactions and artifacts
- `POST /api/v1/code-memory/context` - Retrieve memory context
- `GET /health` - Health check

## Security

- API keys are stored securely in VS Code/Cursor settings (encrypted)
- All communication uses HTTPS
- No sensitive data is logged

See [SECURITY.md](SECURITY.md) for more information.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

**Andrii Kryvosheiev**

## Support

- **Issues**: [GitHub Issues](https://github.com/aipsyhelp/Cursor_ODAM/issues)
- **Documentation**: See the README, CONTRIBUTING, and SECURITY guides in this repository

## Changelog

### 1.0.0

- Initial release
- Basic memory functionality
- Code artifact tracking
- Context injection
- Memory analytics

---

Made with ❤️ for the Cursor community
