---
name: rag-search-quality
category: rag
requires: [synapse-mcp, allow-write]
---

# RAG Search Quality

Test search relevance by creating a small knowledge base with known content, then querying it. Verifies that search returns relevant results and ranks them sensibly.

## Prerequisites

- synapse-mcp connected with `--allow-write`

## Steps

1. **Record baseline.** Call `get_graph_overview`.

2. **Build test knowledge base.** Create these nodes with detailed labels:
   - `create_node` name="Transformer Architecture" type="concept" label="Neural network architecture using self-attention mechanism, introduced in Attention Is All You Need paper by Vaswani et al. Foundation for GPT, BERT, and modern LLMs."
   - `create_node` name="Attention Mechanism" type="concept" label="Core component of transformers that allows the model to weigh different parts of the input sequence. Self-attention computes query, key, and value matrices."
   - `create_node` name="BERT" type="technology" label="Bidirectional Encoder Representations from Transformers. Pre-trained language model by Google for NLP tasks like classification and question answering."
   - `create_node` name="GPT" type="technology" label="Generative Pre-trained Transformer by OpenAI. Autoregressive language model used for text generation, code completion, and reasoning."
   - `create_node` name="Convolutional Neural Network" type="concept" label="Neural network using convolution operations, primarily for image processing. Architectures include ResNet, VGG, and EfficientNet."
   - `create_node` name="Recurrent Neural Network" type="concept" label="Sequential neural network with hidden state. Includes LSTM and GRU variants. Largely superseded by transformers for NLP."
   
3. **Create relationships.**
   - Transformer Architecture → uses → Attention Mechanism
   - BERT → based_on → Transformer Architecture
   - GPT → based_on → Transformer Architecture
   - Recurrent Neural Network → superseded_by → Transformer Architecture

4. **Search: specific query.** Call `search_nodes` query="transformer" — should return "Transformer Architecture" and possibly BERT/GPT.

5. **Search: related concept.** Call `search_nodes` query="attention" — should return "Attention Mechanism" and possibly "Transformer Architecture" (since its label mentions attention).

6. **Search: unrelated.** Call `search_nodes` query="image processing" — should return "Convolutional Neural Network" but NOT transformer/attention nodes.

7. **Neighbor traversal from search result.** Take "Transformer Architecture" node, call `get_neighbors` depth=1. Should find BERT, GPT, Attention Mechanism, and RNN.

8. **Find similar entities.** Call `find_similar_entities` name="Transformer" — should return "Transformer Architecture" as a match.

## Evaluation Criteria

- [ ] Search for "transformer" returns "Transformer Architecture" in results
- [ ] Search for "attention" returns "Attention Mechanism" in results
- [ ] Search for "image processing" returns "Convolutional Neural Network" but not transformer-related nodes
- [ ] Neighbor traversal from Transformer Architecture returns at least 3 connected nodes (BERT, GPT, Attention Mechanism)
- [ ] `find_similar_entities` for "Transformer" finds "Transformer Architecture"
- [ ] All 6 nodes and 4 edges were created without errors

## Cleanup

- Delete all 6 test nodes using `delete_node` (edges are auto-deleted)
- Verify `search_nodes` query="Transformer Architecture" returns empty
