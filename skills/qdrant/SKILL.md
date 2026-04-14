# Skill: qdrant

## Description
Vector database for semantic search on memory observations. Stores high-dimensional embeddings and queries them by cosine/dot-product similarity. Used to back memory systems when mem0's built-in store needs to scale or be queried externally.

## Type
Service (Docker container) + Shell tool

## Configuration
- Container: `qdrant` (on `coolify` network)
- Port: 6333 (REST), 6334 (gRPC)
- Internal URL: `http://qdrant:6333` (from other containers)
- Host URL: `http://127.0.0.1:6333`
- Dashboard: `http://localhost:6333/dashboard`
- npm client: `@qdrant/js-client-rest`
- Compose: `/projects/Overlord/qdrant/docker-compose.yml`

## Shell Tool

`qdrant-tool.sh` provides direct CLI access to all common Qdrant operations.

### Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
| `info` | — | Show Qdrant server info |
| `list-collections` | — | List all collections |
| `create-collection` | `<name> [vector_size]` | Create collection (default size: 1536) |
| `delete-collection` | `<name>` | Delete a collection |
| `upsert` | `<collection> <id> <vector_json> [payload_json]` | Upsert a single point |
| `search` | `<collection> <vector_json> [--limit N]` | Search by vector similarity |

### Examples

```bash
# Server health
./qdrant-tool.sh info

# Collection management
./qdrant-tool.sh create-collection memories 1536
./qdrant-tool.sh list-collections
./qdrant-tool.sh delete-collection memories

# Upsert a point with payload
./qdrant-tool.sh upsert memories 1 '[0.1,0.2,0.3]' '{"text":"Gil surfs at 6am"}'

# Semantic search
./qdrant-tool.sh search memories '[0.1,0.2,0.3]' --limit 3
```

### Environment Overrides
- `QDRANT_HOST` — hostname (default: `qdrant`)
- `QDRANT_PORT` — port (default: `6333`)

## TypeScript Usage

```typescript
import { QdrantClient } from "@qdrant/js-client-rest";

const client = new QdrantClient({ url: "http://qdrant:6333" });

// Create a collection
await client.createCollection("memories", {
  vectors: { size: 1536, distance: "Cosine" }
});

// Upsert vectors
await client.upsert("memories", {
  points: [{ id: 1, vector: embeddingArray, payload: { text: "Gil surfs at 6am" } }]
});

// Query by similarity
const results = await client.search("memories", {
  vector: queryEmbedding,
  limit: 5,
  with_payload: true
});
```

## When to Use
- Adding scalable vector search to memory or knowledge systems
- Storing and querying embeddings when mem0's built-in store is insufficient
- Any feature requiring semantic similarity search over stored observations
- Backing a RAG (retrieval-augmented generation) pipeline

## Requirements
- Docker on `coolify` network
- No GPU required — CPU inference is fine for typical loads
- ~200MB RAM for base container; scales with collection size
