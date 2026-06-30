-- Demo data for Synapse README recording
-- Run: sqlite3 ~/Desktop/obsidian/.kg/graph.db < scripts/demo/seed-demo-data.sql

BEGIN TRANSACTION;

-- ============================================================================
-- PEOPLE
-- ============================================================================

INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, created_at, updated_at)
VALUES
  ('a0000000000000000000000000000001', 'andrej-karpathy', 'Andrej Karpathy', 'entity', 'person',
   'AI researcher, founding member of OpenAI, former Sr. Director of AI at Tesla. Known for CS231n and minGPT.',
   '{"field":"deep learning","nationality":"Slovak-Canadian"}',
   -120, -80, '#4F46E5', 1.6, '2024-11-15 10:00:00', '2024-11-15 10:00:00'),

  ('a0000000000000000000000000000002', 'dario-amodei', 'Dario Amodei', 'entity', 'person',
   'CEO and co-founder of Anthropic. Former VP of Research at OpenAI. Pioneered scaling laws research.',
   '{"field":"AI safety","nationality":"American"}',
   320, 180, '#4F46E5', 1.8, '2024-11-15 10:01:00', '2024-11-15 10:01:00'),

  ('a0000000000000000000000000000003', 'sam-altman', 'Sam Altman', 'entity', 'person',
   'CEO of OpenAI. Former president of Y Combinator. Driving force behind ChatGPT and GPT-4.',
   '{"field":"AI leadership","nationality":"American"}',
   -280, -200, '#4F46E5', 1.8, '2024-11-15 10:02:00', '2024-11-15 10:02:00'),

  ('a0000000000000000000000000000004', 'demis-hassabis', 'Demis Hassabis', 'entity', 'person',
   'CEO and co-founder of DeepMind. Nobel Prize in Chemistry 2024 for AlphaFold. Former game designer.',
   '{"field":"artificial general intelligence","nationality":"British"}',
   180, -320, '#4F46E5', 1.8, '2024-11-15 10:03:00', '2024-11-15 10:03:00'),

  ('a0000000000000000000000000000005', 'ilya-sutskever', 'Ilya Sutskever', 'entity', 'person',
   'Co-founder of OpenAI, later founded Safe Superintelligence Inc. Key contributor to AlexNet and sequence-to-sequence learning.',
   '{"field":"deep learning","nationality":"Israeli-Canadian"}',
   -200, -350, '#4F46E5', 1.6, '2024-11-15 10:04:00', '2024-11-15 10:04:00'),

  ('a0000000000000000000000000000006', 'yann-lecun', 'Yann LeCun', 'entity', 'person',
   'Chief AI Scientist at Meta. Turing Award 2018. Pioneer of convolutional neural networks and self-supervised learning.',
   '{"field":"computer vision","nationality":"French-American"}',
   -50, 350, '#4F46E5', 1.7, '2024-11-15 10:05:00', '2024-11-15 10:05:00'),

  ('a0000000000000000000000000000007', 'fei-fei-li', 'Fei-Fei Li', 'entity', 'person',
   'Professor at Stanford. Creator of ImageNet. Co-director of Stanford Human-Centered AI Institute.',
   '{"field":"computer vision","nationality":"Chinese-American"}',
   400, -80, '#4F46E5', 1.5, '2024-11-15 10:06:00', '2024-11-15 10:06:00'),

  ('a0000000000000000000000000000008', 'geoffrey-hinton', 'Geoffrey Hinton', 'entity', 'person',
   'Godfather of deep learning. Turing Award 2018. Nobel Prize in Physics 2024 for foundational work on neural networks.',
   '{"field":"neural networks","nationality":"British-Canadian"}',
   -380, 200, '#4F46E5', 1.9, '2024-11-15 10:07:00', '2024-11-15 10:07:00'),

  ('a0000000000000000000000000000009', 'ian-goodfellow', 'Ian Goodfellow', 'entity', 'person',
   'Inventor of generative adversarial networks (GANs). Former researcher at Google Brain and Apple.',
   '{"field":"generative models","nationality":"American"}',
   -450, 50, '#4F46E5', 1.4, '2024-11-15 10:08:00', '2024-11-15 10:08:00'),

  ('a000000000000000000000000000000a', 'ashish-vaswani', 'Ashish Vaswani', 'entity', 'person',
   'Lead author of "Attention Is All You Need." Co-founded Essential AI. Former Google Brain researcher.',
   '{"field":"natural language processing","nationality":"Indian-American"}',
   50, -180, '#4F46E5', 1.6, '2024-11-15 10:09:00', '2024-11-15 10:09:00');


-- ============================================================================
-- ORGANIZATIONS
-- ============================================================================

INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, created_at, updated_at)
VALUES
  ('b0000000000000000000000000000001', 'openai', 'OpenAI', 'entity', 'organization',
   'AI research lab behind GPT-4, ChatGPT, and DALL-E. Founded 2015, transitioned from nonprofit to capped-profit.',
   '{"founded":"2015","headquarters":"San Francisco"}',
   -250, -120, '#D97706', 2.0, '2024-11-15 10:10:00', '2024-11-15 10:10:00'),

  ('b0000000000000000000000000000002', 'anthropic', 'Anthropic', 'entity', 'organization',
   'AI safety company building Claude. Founded 2021 by former OpenAI researchers. Pioneered Constitutional AI.',
   '{"founded":"2021","headquarters":"San Francisco"}',
   350, 120, '#D97706', 1.8, '2024-11-15 10:11:00', '2024-11-15 10:11:00'),

  ('b0000000000000000000000000000003', 'google-deepmind', 'Google DeepMind', 'entity', 'organization',
   'AI research lab formed by merging Google Brain and DeepMind. Behind Gemini, AlphaFold, and AlphaGo.',
   '{"founded":"2010","headquarters":"London"}',
   150, -250, '#D97706', 1.9, '2024-11-15 10:12:00', '2024-11-15 10:12:00'),

  ('b0000000000000000000000000000004', 'meta-ai', 'Meta AI', 'entity', 'organization',
   'Meta''s AI research division. Open-sourced LLaMA and PyTorch. Led by Yann LeCun.',
   '{"founded":"2013","headquarters":"Menlo Park"}',
   -100, 300, '#D97706', 1.7, '2024-11-15 10:13:00', '2024-11-15 10:13:00'),

  ('b0000000000000000000000000000005', 'stanford-ai-lab', 'Stanford AI Lab', 'entity', 'organization',
   'Stanford''s AI research lab (SAIL). Birthplace of ImageNet. Led groundbreaking work in NLP and robotics.',
   '{"founded":"1962","headquarters":"Stanford, CA"}',
   420, -150, '#D97706', 1.4, '2024-11-15 10:14:00', '2024-11-15 10:14:00'),

  ('b0000000000000000000000000000006', 'tesla-ai', 'Tesla AI', 'entity', 'organization',
   'Tesla''s AI and Autopilot division. Focused on real-world computer vision and autonomous driving.',
   '{"founded":"2016","headquarters":"Palo Alto"}',
   -180, 50, '#D97706', 1.3, '2024-11-15 10:15:00', '2024-11-15 10:15:00');


-- ============================================================================
-- TECHNOLOGIES
-- ============================================================================

INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, created_at, updated_at)
VALUES
  ('c0000000000000000000000000000001', 'gpt-4', 'GPT-4', 'entity', 'technology',
   'OpenAI''s large multimodal model. State-of-the-art reasoning, coding, and instruction following.',
   '{"released":"2023-03","parameters":"~1.8T (estimated)","modality":"text+vision"}',
   -350, -280, '#DC2626', 1.8, '2024-11-15 10:16:00', '2024-11-15 10:16:00'),

  ('c0000000000000000000000000000002', 'claude', 'Claude', 'entity', 'technology',
   'Anthropic''s AI assistant family. Trained with Constitutional AI and RLHF for safety and helpfulness.',
   '{"released":"2023-03","latest":"Claude 4 Opus","modality":"text+vision"}',
   420, 200, '#DC2626', 1.7, '2024-11-15 10:17:00', '2024-11-15 10:17:00'),

  ('c0000000000000000000000000000003', 'gemini', 'Gemini', 'entity', 'technology',
   'Google DeepMind''s multimodal AI model family. Natively multimodal across text, code, image, audio, and video.',
   '{"released":"2023-12","latest":"Gemini 2.5","modality":"multimodal"}',
   100, -400, '#DC2626', 1.6, '2024-11-15 10:18:00', '2024-11-15 10:18:00'),

  ('c0000000000000000000000000000004', 'llama', 'LLaMA', 'entity', 'technology',
   'Meta''s open-weight large language model family. Democratized access to powerful LLMs for researchers.',
   '{"released":"2023-02","latest":"LLaMA 4","modality":"text"}',
   -200, 400, '#DC2626', 1.5, '2024-11-15 10:19:00', '2024-11-15 10:19:00'),

  ('c0000000000000000000000000000005', 'transformers', 'Transformers', 'entity', 'technology',
   'Neural network architecture based on self-attention. Foundation of modern NLP and generative AI.',
   '{"published":"2017","paper":"Attention Is All You Need"}',
   0, -100, '#DC2626', 2.0, '2024-11-15 10:20:00', '2024-11-15 10:20:00'),

  ('c0000000000000000000000000000006', 'pytorch', 'PyTorch', 'entity', 'technology',
   'Open-source machine learning framework. Dominant in research due to dynamic computation graphs.',
   '{"released":"2016","maintainer":"Meta AI"}',
   -250, 250, '#DC2626', 1.5, '2024-11-15 10:21:00', '2024-11-15 10:21:00'),

  ('c0000000000000000000000000000007', 'tensorflow', 'TensorFlow', 'entity', 'technology',
   'Google''s open-source ML framework. Pioneered production ML deployment at scale.',
   '{"released":"2015","maintainer":"Google"}',
   50, 250, '#DC2626', 1.4, '2024-11-15 10:22:00', '2024-11-15 10:22:00'),

  ('c0000000000000000000000000000008', 'alphafold', 'AlphaFold', 'entity', 'technology',
   'DeepMind''s protein structure prediction system. Solved a 50-year grand challenge in biology.',
   '{"released":"2020","impact":"predicted 200M+ protein structures"}',
   250, -400, '#DC2626', 1.7, '2024-11-15 10:23:00', '2024-11-15 10:23:00'),

  ('c0000000000000000000000000000009', 'dall-e', 'DALL-E', 'entity', 'technology',
   'OpenAI''s text-to-image generation model. Pioneered high-quality image synthesis from text prompts.',
   '{"released":"2021-01","latest":"DALL-E 3"}',
   -400, -180, '#DC2626', 1.4, '2024-11-15 10:24:00', '2024-11-15 10:24:00'),

  ('c000000000000000000000000000000a', 'stable-diffusion', 'Stable Diffusion', 'entity', 'technology',
   'Open-source text-to-image model by Stability AI. Runs locally, widely adopted by the open-source community.',
   '{"released":"2022-08","architecture":"latent diffusion"}',
   -480, -100, '#DC2626', 1.3, '2024-11-15 10:25:00', '2024-11-15 10:25:00');


-- ============================================================================
-- CONCEPTS
-- ============================================================================

INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, created_at, updated_at)
VALUES
  ('d0000000000000000000000000000001', 'attention-mechanism', 'Attention Mechanism', 'entity', 'concept',
   'Core innovation behind Transformers. Allows models to weigh the relevance of different parts of the input dynamically.',
   '{"introduced":"2014 (Bahdanau), 2017 (self-attention)"}',
   80, -50, '#7C3AED', 1.8, '2024-11-15 10:26:00', '2024-11-15 10:26:00'),

  ('d0000000000000000000000000000002', 'rlhf', 'RLHF', 'entity', 'concept',
   'Reinforcement Learning from Human Feedback. Technique for aligning LLMs with human preferences and values.',
   '{"key_paper":"Training language models to follow instructions (2022)"}',
   250, 50, '#7C3AED', 1.6, '2024-11-15 10:27:00', '2024-11-15 10:27:00'),

  ('d0000000000000000000000000000003', 'constitutional-ai', 'Constitutional AI', 'entity', 'concept',
   'Anthropic''s approach to AI alignment using a set of principles (constitution) to guide model behavior without extensive human feedback.',
   '{"published":"2022","author":"Anthropic"}',
   400, 300, '#7C3AED', 1.5, '2024-11-15 10:28:00', '2024-11-15 10:28:00'),

  ('d0000000000000000000000000000004', 'scaling-laws', 'Scaling Laws', 'entity', 'concept',
   'Empirical finding that model performance improves predictably with compute, data, and parameters. Guides billion-dollar training decisions.',
   '{"key_paper":"Scaling Laws for Neural Language Models (Kaplan et al., 2020)"}',
   200, 100, '#7C3AED', 1.6, '2024-11-15 10:29:00', '2024-11-15 10:29:00'),

  ('d0000000000000000000000000000005', 'chain-of-thought', 'Chain of Thought', 'entity', 'concept',
   'Prompting technique that elicits step-by-step reasoning from LLMs, dramatically improving performance on complex tasks.',
   '{"key_paper":"Chain-of-Thought Prompting (Wei et al., 2022)"}',
   -100, -250, '#7C3AED', 1.4, '2024-11-15 10:30:00', '2024-11-15 10:30:00'),

  ('d0000000000000000000000000000006', 'neural-architecture-search', 'Neural Architecture Search', 'entity', 'concept',
   'Automated method for designing neural network architectures. Uses search algorithms to find optimal topologies.',
   '{"introduced":"2016"}',
   300, -200, '#7C3AED', 1.2, '2024-11-15 10:31:00', '2024-11-15 10:31:00'),

  ('d0000000000000000000000000000007', 'diffusion-models', 'Diffusion Models', 'entity', 'concept',
   'Generative models that learn to reverse a noise-adding process. Foundation of modern image and video generation.',
   '{"key_paper":"Denoising Diffusion Probabilistic Models (2020)"}',
   -420, -30, '#7C3AED', 1.5, '2024-11-15 10:32:00', '2024-11-15 10:32:00'),

  ('d0000000000000000000000000000008', 'self-supervised-learning', 'Self-Supervised Learning', 'entity', 'concept',
   'Training paradigm where models learn from unlabeled data by predicting parts of the input. Powers modern LLMs and vision models.',
   '{"advocate":"Yann LeCun"}',
   -150, 180, '#7C3AED', 1.5, '2024-11-15 10:33:00', '2024-11-15 10:33:00');


-- ============================================================================
-- EVENTS
-- ============================================================================

INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, created_at, updated_at)
VALUES
  ('e0000000000000000000000000000001', 'chatgpt-launch', 'ChatGPT Launch', 'entity', 'event',
   'November 30, 2022. OpenAI released ChatGPT, reaching 100M users in 2 months — the fastest-growing consumer app in history.',
   '{"date":"2022-11-30","impact":"catalyzed global AI investment wave"}',
   -300, -350, '#0891B2', 1.7, '2024-11-15 10:34:00', '2024-11-15 10:34:00'),

  ('e0000000000000000000000000000002', 'transformer-paper', 'Transformer Paper Publication', 'entity', 'event',
   'June 2017. "Attention Is All You Need" published by Vaswani et al. at Google. Introduced the Transformer architecture.',
   '{"date":"2017-06-12","venue":"NeurIPS 2017","citations":"130,000+"}',
   50, -250, '#0891B2', 1.8, '2024-11-15 10:35:00', '2024-11-15 10:35:00'),

  ('e0000000000000000000000000000003', 'imagenet-moment', 'ImageNet Moment', 'entity', 'event',
   'September 2012. AlexNet won ImageNet by a huge margin, proving deep learning works. Ignited the deep learning revolution.',
   '{"date":"2012-09-30","impact":"launched the deep learning era"}',
   -300, 120, '#0891B2', 1.6, '2024-11-15 10:36:00', '2024-11-15 10:36:00'),

  ('e0000000000000000000000000000004', 'alphago-match', 'AlphaGo Match', 'entity', 'event',
   'March 2016. DeepMind''s AlphaGo defeated world champion Lee Sedol at Go, a game thought to be decades away from AI mastery.',
   '{"date":"2016-03-09","result":"4-1 AlphaGo","location":"Seoul"}',
   250, -350, '#0891B2', 1.5, '2024-11-15 10:37:00', '2024-11-15 10:37:00');


-- ============================================================================
-- METHODOLOGIES
-- ============================================================================

INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, created_at, updated_at)
VALUES
  ('f0000000000000000000000000000001', 'fine-tuning', 'Fine-tuning', 'entity', 'methodology',
   'Adapting a pre-trained model to a specific task or domain by continuing training on targeted data.',
   '{"variants":"full, LoRA, QLoRA, adapter-based"}',
   150, 150, '#DB2777', 1.4, '2024-11-15 10:38:00', '2024-11-15 10:38:00'),

  ('f0000000000000000000000000000002', 'prompt-engineering', 'Prompt Engineering', 'entity', 'methodology',
   'Craft of designing inputs to LLMs to elicit desired outputs. Includes few-shot, chain-of-thought, and system prompts.',
   '{"techniques":"zero-shot, few-shot, chain-of-thought, tree-of-thought"}',
   -50, -350, '#DB2777', 1.3, '2024-11-15 10:39:00', '2024-11-15 10:39:00'),

  ('f0000000000000000000000000000003', 'red-teaming', 'Red Teaming', 'entity', 'methodology',
   'Adversarial testing of AI systems to find failure modes, biases, and safety vulnerabilities before deployment.',
   '{"used_by":"OpenAI, Anthropic, Google DeepMind"}',
   350, 350, '#DB2777', 1.3, '2024-11-15 10:40:00', '2024-11-15 10:40:00');


-- ============================================================================
-- EDGES — People ↔ Organizations
-- ============================================================================

INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at) VALUES
  -- Karpathy
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000001', 'b0000000000000000000000000000001', 'affiliated_with', 'affiliated_with', '{"role":"founding member","period":"2015-2017"}', 1.0, 1, '2024-11-15 11:00:00', '2024-11-15 11:00:00'),
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000001', 'b0000000000000000000000000000006', 'affiliated_with', 'affiliated_with', '{"role":"Sr. Director of AI","period":"2017-2022"}', 1.0, 1, '2024-11-15 11:00:01', '2024-11-15 11:00:01'),
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000001', 'b0000000000000000000000000000005', 'affiliated_with', 'affiliated_with', '{"role":"PhD student (under Fei-Fei Li)"}', 0.8, 1, '2024-11-15 11:00:02', '2024-11-15 11:00:02'),
  -- Dario Amodei
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000002', 'b0000000000000000000000000000002', 'affiliated_with', 'affiliated_with', '{"role":"CEO & co-founder","period":"2021-present"}', 1.0, 1, '2024-11-15 11:00:03', '2024-11-15 11:00:03'),
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000002', 'b0000000000000000000000000000001', 'affiliated_with', 'affiliated_with', '{"role":"VP of Research","period":"2016-2021"}', 0.9, 1, '2024-11-15 11:00:04', '2024-11-15 11:00:04'),
  -- Sam Altman
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000003', 'b0000000000000000000000000000001', 'affiliated_with', 'affiliated_with', '{"role":"CEO","period":"2019-present"}', 1.0, 1, '2024-11-15 11:00:05', '2024-11-15 11:00:05'),
  -- Demis Hassabis
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000004', 'b0000000000000000000000000000003', 'affiliated_with', 'affiliated_with', '{"role":"CEO & co-founder","period":"2010-present"}', 1.0, 1, '2024-11-15 11:00:06', '2024-11-15 11:00:06'),
  -- Ilya Sutskever
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000005', 'b0000000000000000000000000000001', 'affiliated_with', 'affiliated_with', '{"role":"co-founder & Chief Scientist","period":"2015-2024"}', 1.0, 1, '2024-11-15 11:00:07', '2024-11-15 11:00:07'),
  -- Yann LeCun
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000006', 'b0000000000000000000000000000004', 'affiliated_with', 'affiliated_with', '{"role":"Chief AI Scientist","period":"2013-present"}', 1.0, 1, '2024-11-15 11:00:08', '2024-11-15 11:00:08'),
  -- Fei-Fei Li
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000007', 'b0000000000000000000000000000005', 'affiliated_with', 'affiliated_with', '{"role":"Professor, co-director HAI","period":"2009-present"}', 1.0, 1, '2024-11-15 11:00:09', '2024-11-15 11:00:09'),
  -- Geoffrey Hinton
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000008', 'b0000000000000000000000000000003', 'affiliated_with', 'affiliated_with', '{"role":"VP & Engineering Fellow (Google Brain)","period":"2013-2023"}', 0.9, 1, '2024-11-15 11:00:10', '2024-11-15 11:00:10'),
  -- Ian Goodfellow
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000009', 'b0000000000000000000000000000003', 'affiliated_with', 'affiliated_with', '{"role":"researcher (Google Brain)","period":"2014-2017"}', 0.8, 1, '2024-11-15 11:00:11', '2024-11-15 11:00:11'),
  -- Ashish Vaswani
  (lower(hex(randomblob(16))), 'a000000000000000000000000000000a', 'b0000000000000000000000000000003', 'affiliated_with', 'affiliated_with', '{"role":"researcher (Google Brain)","period":"2016-2021"}', 0.8, 1, '2024-11-15 11:00:12', '2024-11-15 11:00:12');


-- ============================================================================
-- EDGES — People → Technologies (created_by)
-- ============================================================================

INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at) VALUES
  -- Vaswani created Transformers
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000005', 'a000000000000000000000000000000a', 'created_by', 'created_by', '{"paper":"Attention Is All You Need"}', 1.0, 1, '2024-11-15 11:01:00', '2024-11-15 11:01:00'),
  -- Hassabis → AlphaFold
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000008', 'a0000000000000000000000000000004', 'created_by', 'created_by', '{"organization":"DeepMind"}', 1.0, 1, '2024-11-15 11:01:01', '2024-11-15 11:01:01'),
  -- Goodfellow → GANs (represented via diffusion models lineage)
  (lower(hex(randomblob(16))), 'd0000000000000000000000000000007', 'a0000000000000000000000000000009', 'created_by', 'created_by', '{"note":"GANs preceded diffusion models"}', 0.7, 1, '2024-11-15 11:01:02', '2024-11-15 11:01:02'),
  -- Fei-Fei Li created ImageNet (event link)
  (lower(hex(randomblob(16))), 'e0000000000000000000000000000003', 'a0000000000000000000000000000007', 'created_by', 'created_by', '{"dataset":"ImageNet"}', 1.0, 1, '2024-11-15 11:01:03', '2024-11-15 11:01:03');


-- ============================================================================
-- EDGES — Organizations → Technologies
-- ============================================================================

INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at) VALUES
  -- OpenAI → GPT-4
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000001', 'b0000000000000000000000000000001', 'created_by', 'created_by', '{}', 1.0, 1, '2024-11-15 11:02:00', '2024-11-15 11:02:00'),
  -- Anthropic → Claude
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000002', 'b0000000000000000000000000000002', 'created_by', 'created_by', '{}', 1.0, 1, '2024-11-15 11:02:01', '2024-11-15 11:02:01'),
  -- DeepMind → Gemini
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000003', 'b0000000000000000000000000000003', 'created_by', 'created_by', '{}', 1.0, 1, '2024-11-15 11:02:02', '2024-11-15 11:02:02'),
  -- Meta → LLaMA
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000004', 'b0000000000000000000000000000004', 'created_by', 'created_by', '{}', 1.0, 1, '2024-11-15 11:02:03', '2024-11-15 11:02:03'),
  -- Meta → PyTorch
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000006', 'b0000000000000000000000000000004', 'created_by', 'created_by', '{}', 1.0, 1, '2024-11-15 11:02:04', '2024-11-15 11:02:04'),
  -- Google → TensorFlow
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000007', 'b0000000000000000000000000000003', 'created_by', 'created_by', '{}', 1.0, 1, '2024-11-15 11:02:05', '2024-11-15 11:02:05'),
  -- DeepMind → AlphaFold
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000008', 'b0000000000000000000000000000003', 'created_by', 'created_by', '{}', 1.0, 1, '2024-11-15 11:02:06', '2024-11-15 11:02:06'),
  -- OpenAI → DALL-E
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000009', 'b0000000000000000000000000000001', 'created_by', 'created_by', '{}', 1.0, 1, '2024-11-15 11:02:07', '2024-11-15 11:02:07');


-- ============================================================================
-- EDGES — Technologies → Concepts (builds_on / used_in)
-- ============================================================================

INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at) VALUES
  -- Transformers builds_on Attention
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000005', 'd0000000000000000000000000000001', 'builds_on', 'builds_on', '{}', 1.0, 1, '2024-11-15 11:03:00', '2024-11-15 11:03:00'),
  -- GPT-4 builds_on Transformers
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000001', 'c0000000000000000000000000000005', 'builds_on', 'builds_on', '{}', 1.0, 1, '2024-11-15 11:03:01', '2024-11-15 11:03:01'),
  -- Claude builds_on Transformers
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000002', 'c0000000000000000000000000000005', 'builds_on', 'builds_on', '{}', 1.0, 1, '2024-11-15 11:03:02', '2024-11-15 11:03:02'),
  -- Gemini builds_on Transformers
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000003', 'c0000000000000000000000000000005', 'builds_on', 'builds_on', '{}', 1.0, 1, '2024-11-15 11:03:03', '2024-11-15 11:03:03'),
  -- LLaMA builds_on Transformers
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000004', 'c0000000000000000000000000000005', 'builds_on', 'builds_on', '{}', 1.0, 1, '2024-11-15 11:03:04', '2024-11-15 11:03:04'),
  -- Claude used_in Constitutional AI
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000002', 'd0000000000000000000000000000003', 'used_in', 'used_in', '{}', 1.0, 1, '2024-11-15 11:03:05', '2024-11-15 11:03:05'),
  -- GPT-4 used_in RLHF
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000001', 'd0000000000000000000000000000002', 'used_in', 'used_in', '{}', 1.0, 1, '2024-11-15 11:03:06', '2024-11-15 11:03:06'),
  -- Claude used_in RLHF
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000002', 'd0000000000000000000000000000002', 'used_in', 'used_in', '{}', 1.0, 1, '2024-11-15 11:03:07', '2024-11-15 11:03:07'),
  -- Stable Diffusion builds_on Diffusion Models
  (lower(hex(randomblob(16))), 'c000000000000000000000000000000a', 'd0000000000000000000000000000007', 'builds_on', 'builds_on', '{}', 1.0, 1, '2024-11-15 11:03:08', '2024-11-15 11:03:08'),
  -- DALL-E builds_on Diffusion Models
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000009', 'd0000000000000000000000000000007', 'builds_on', 'builds_on', '{}', 1.0, 1, '2024-11-15 11:03:09', '2024-11-15 11:03:09');


-- ============================================================================
-- EDGES — Concepts → Concepts / cross-links
-- ============================================================================

INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at) VALUES
  -- Constitutional AI builds_on RLHF
  (lower(hex(randomblob(16))), 'd0000000000000000000000000000003', 'd0000000000000000000000000000002', 'builds_on', 'builds_on', '{}', 1.0, 1, '2024-11-15 11:04:00', '2024-11-15 11:04:00'),
  -- Chain of Thought enables Prompt Engineering
  (lower(hex(randomblob(16))), 'd0000000000000000000000000000005', 'f0000000000000000000000000000002', 'enables', 'enables', '{}', 1.0, 1, '2024-11-15 11:04:01', '2024-11-15 11:04:01'),
  -- Self-Supervised Learning enables Scaling Laws
  (lower(hex(randomblob(16))), 'd0000000000000000000000000000008', 'd0000000000000000000000000000004', 'enables', 'enables', '{}', 0.9, 1, '2024-11-15 11:04:02', '2024-11-15 11:04:02'),
  -- Scaling Laws → Dario Amodei (research)
  (lower(hex(randomblob(16))), 'd0000000000000000000000000000004', 'a0000000000000000000000000000002', 'created_by', 'created_by', '{"note":"key researcher on scaling laws"}', 0.8, 1, '2024-11-15 11:04:03', '2024-11-15 11:04:03'),
  -- Yann LeCun champions Self-Supervised Learning
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000006', 'd0000000000000000000000000000008', 'related', 'related', '{"note":"leading advocate"}', 0.9, 1, '2024-11-15 11:04:04', '2024-11-15 11:04:04'),
  -- Red Teaming used_in Constitutional AI
  (lower(hex(randomblob(16))), 'f0000000000000000000000000000003', 'd0000000000000000000000000000003', 'related', 'related', '{}', 0.8, 1, '2024-11-15 11:04:05', '2024-11-15 11:04:05'),
  -- Fine-tuning builds_on Self-Supervised Learning
  (lower(hex(randomblob(16))), 'f0000000000000000000000000000001', 'd0000000000000000000000000000008', 'builds_on', 'builds_on', '{}', 0.9, 1, '2024-11-15 11:04:06', '2024-11-15 11:04:06');


-- ============================================================================
-- EDGES — Events
-- ============================================================================

INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at) VALUES
  -- ChatGPT Launch → OpenAI
  (lower(hex(randomblob(16))), 'e0000000000000000000000000000001', 'b0000000000000000000000000000001', 'affiliated_with', 'affiliated_with', '{}', 1.0, 1, '2024-11-15 11:05:00', '2024-11-15 11:05:00'),
  -- ChatGPT Launch preceded_by GPT-4
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000001', 'e0000000000000000000000000000001', 'preceded_by', 'preceded_by', '{}', 0.8, 1, '2024-11-15 11:05:01', '2024-11-15 11:05:01'),
  -- Transformer Paper → Transformers tech
  (lower(hex(randomblob(16))), 'e0000000000000000000000000000002', 'c0000000000000000000000000000005', 'related', 'related', '{}', 1.0, 1, '2024-11-15 11:05:02', '2024-11-15 11:05:02'),
  -- Transformer Paper → Vaswani
  (lower(hex(randomblob(16))), 'e0000000000000000000000000000002', 'a000000000000000000000000000000a', 'created_by', 'created_by', '{}', 1.0, 1, '2024-11-15 11:05:03', '2024-11-15 11:05:03'),
  -- ImageNet Moment → Hinton
  (lower(hex(randomblob(16))), 'e0000000000000000000000000000003', 'a0000000000000000000000000000008', 'created_by', 'created_by', '{"note":"AlexNet by Hinton''s students"}', 1.0, 1, '2024-11-15 11:05:04', '2024-11-15 11:05:04'),
  -- AlphaGo Match → DeepMind
  (lower(hex(randomblob(16))), 'e0000000000000000000000000000004', 'b0000000000000000000000000000003', 'affiliated_with', 'affiliated_with', '{}', 1.0, 1, '2024-11-15 11:05:05', '2024-11-15 11:05:05'),
  -- AlphaGo preceded AlphaFold
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000008', 'e0000000000000000000000000000004', 'preceded_by', 'preceded_by', '{}', 0.7, 1, '2024-11-15 11:05:06', '2024-11-15 11:05:06'),
  -- Hinton → Ilya (mentor)
  (lower(hex(randomblob(16))), 'a0000000000000000000000000000005', 'a0000000000000000000000000000008', 'related', 'related', '{"note":"PhD advisor"}', 1.0, 1, '2024-11-15 11:05:07', '2024-11-15 11:05:07'),
  -- PyTorch alternative_to TensorFlow
  (lower(hex(randomblob(16))), 'c0000000000000000000000000000006', 'c0000000000000000000000000000007', 'alternative_to', 'alternative_to', '{}', 1.0, 1, '2024-11-15 11:05:08', '2024-11-15 11:05:08');

COMMIT;
