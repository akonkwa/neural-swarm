const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory session store (TTL: 1 hour)
const sessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 3600000) sessions.delete(id);
  }
}, 600000);

// ── Agent role definitions ──────────────────────────
const ROLES = {
  coordinator: { symbol: '\u25C6', color: '#00ff41', label: 'Coordinator' },
  worker:      { symbol: '\u25CF', color: '#00ffff', label: 'Worker' },
  validator:   { symbol: '\u25C7', color: '#ff00ff', label: 'Validator' },
  tool:        { symbol: '\u2699', color: '#ffd700', label: 'Tool' },
  memory:      { symbol: '\u25C8', color: '#ff6b35', label: 'Memory' },
};

// ── Simulation Engine ───────────────────────────────
function createAgents(count) {
  const agents = [];
  agents.push({ id: 'C0', role: 'coordinator', ...ROLES.coordinator });
  const workerCount = Math.max(1, count - 2);
  for (let i = 0; i < workerCount; i++) {
    agents.push({ id: `W${i + 1}`, role: 'worker', ...ROLES.worker });
  }
  agents.push({ id: 'V0', role: 'validator', ...ROLES.validator });
  if (count >= 5) agents.push({ id: 'T0', role: 'tool', ...ROLES.tool });
  if (count >= 7) agents.push({ id: 'M0', role: 'memory', ...ROLES.memory });
  return agents;
}

function generateConnections(agents, topology) {
  const conns = [];
  const coord = agents[0];
  const workers = agents.filter(a => a.role === 'worker');
  const validator = agents.find(a => a.role === 'validator');
  const tool = agents.find(a => a.role === 'tool');
  const memory = agents.find(a => a.role === 'memory');

  if (topology === 'star') {
    for (const a of agents) {
      if (a.id !== coord.id) conns.push({ from: coord.id, to: a.id });
    }
    if (tool) workers.forEach(w => conns.push({ from: w.id, to: tool.id }));
    if (validator) workers.forEach(w => conns.push({ from: w.id, to: validator.id }));
  } else if (topology === 'mesh') {
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        conns.push({ from: agents[i].id, to: agents[j].id });
      }
    }
  } else {
    // pipeline
    const ordered = [coord, ...workers, validator].filter(Boolean);
    for (let i = 0; i < ordered.length - 1; i++) {
      conns.push({ from: ordered[i].id, to: ordered[i + 1].id });
    }
    if (tool && workers.length) conns.push({ from: workers[0].id, to: tool.id });
    if (memory) conns.push({ from: coord.id, to: memory.id });
  }
  return conns;
}

function simulateMessages(agents, task) {
  const msgs = [];
  const coord = agents[0];
  const workers = agents.filter(a => a.role === 'worker');
  const validator = agents.find(a => a.role === 'validator');
  const tool = agents.find(a => a.role === 'tool');
  const memory = agents.find(a => a.role === 'memory');
  let t = 0;

  // Phase 1 — Task ingestion
  msgs.push({ from: 'SYS', to: coord.id, type: 'task', content: `Received: "${(task || '').slice(0, 50)}"`, time: t, latency: 10 });
  t += 300;

  // Phase 2 — Memory lookup
  if (memory) {
    msgs.push({ from: coord.id, to: memory.id, type: 'query', content: 'Querying knowledge base...', time: t, latency: 25 });
    t += 500;
    msgs.push({ from: memory.id, to: coord.id, type: 'data', content: 'Context retrieved (3 entries)', time: t, latency: 15 });
    t += 400;
  }

  // Phase 3 — Decomposition
  msgs.push({ from: coord.id, to: coord.id, type: 'think', content: `Decomposing into ${workers.length} subtasks`, time: t, latency: 30 });
  t += 600;

  // Phase 4 — Delegation
  workers.forEach((w, i) => {
    msgs.push({ from: coord.id, to: w.id, type: 'delegate', content: `Subtask ${i + 1}: process partition`, time: t, latency: 15 + (Math.random() * 20 | 0) });
    t += 250;
  });
  t += 300;

  // Phase 5 — Worker execution (first worker uses tool if available)
  workers.forEach((w, i) => {
    if (tool && i === 0) {
      msgs.push({ from: w.id, to: tool.id, type: 'tool_call', content: 'Invoking external tool...', time: t, latency: 45 });
      t += 500;
      msgs.push({ from: tool.id, to: w.id, type: 'tool_result', content: 'Tool result received', time: t, latency: 20 });
      t += 400;
    }
    msgs.push({ from: w.id, to: coord.id, type: 'result', content: `Subtask ${i + 1} complete`, time: t, latency: 10 + (Math.random() * 15 | 0) });
    t += 350;
  });
  t += 300;

  // Phase 6 — Validation
  msgs.push({ from: coord.id, to: validator.id, type: 'verify', content: 'Validate aggregated results', time: t, latency: 20 });
  t += 600;
  msgs.push({ from: validator.id, to: coord.id, type: 'approved', content: 'All results validated \u2713', time: t, latency: 15 });
  t += 400;

  // Phase 7 — Complete
  msgs.push({ from: coord.id, to: 'SYS', type: 'complete', content: 'Orchestration complete', time: t, latency: 5 });
  return msgs;
}

function simulateSwarm(task, agentCount, topology) {
  const agents = createAgents(agentCount);
  const connections = generateConnections(agents, topology);
  const messages = simulateMessages(agents, task);
  return {
    agents,
    connections,
    messages,
    task,
    topology,
    totalLatency: messages.reduce((s, m) => s + m.latency, 0),
    createdAt: Date.now(),
    result: `Task decomposed into ${agents.filter(a => a.role === 'worker').length} subtasks \u2192 processed \u2192 validated \u2713`,
  };
}

// ── Helpers ──────────────────────────────────────────
function getBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

// ── Routes ──────────────────────────────────────────

// POST — primary Join39 endpoint
app.post('/api/orchestrate', (req, res) => {
  const { task, agents = 5, topology = 'star' } = req.body;
  if (!task) return res.status(400).json({ error: 'task is required' });

  const n = Math.min(8, Math.max(3, Number(agents) || 5));
  const topo = ['star', 'mesh', 'pipeline'].includes(topology) ? topology : 'star';
  const sessionId = crypto.randomBytes(6).toString('hex');
  const sim = simulateSwarm(task, n, topo);
  sessions.set(sessionId, sim);

  res.json({
    status: 'completed',
    task: task.slice(0, 100),
    agents_used: sim.agents.length,
    topology: topo,
    messages_exchanged: sim.messages.length,
    total_latency_ms: sim.totalLatency,
    result: sim.result,
    visualization: `${getBaseUrl(req)}/viz/${sessionId}`,
  });
});

// GET — alternative for Join39
app.get('/api/orchestrate', (req, res) => {
  const { task, agents = 5, topology = 'star' } = req.query;
  if (!task) return res.status(400).json({ error: 'task is required' });

  const n = Math.min(8, Math.max(3, parseInt(agents) || 5));
  const topo = ['star', 'mesh', 'pipeline'].includes(topology) ? topology : 'star';
  const sessionId = crypto.randomBytes(6).toString('hex');
  const sim = simulateSwarm(task, n, topo);
  sessions.set(sessionId, sim);

  res.json({
    status: 'completed',
    task: task.slice(0, 100),
    agents_used: sim.agents.length,
    topology: topo,
    messages_exchanged: sim.messages.length,
    total_latency_ms: sim.totalLatency,
    result: sim.result,
    visualization: `${getBaseUrl(req)}/viz/${sessionId}`,
  });
});

// Session data for the visualization page
app.get('/api/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session expired or not found' });
  res.json(session);
});

// Visualization page
app.get('/viz/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viz.html'));
});

app.listen(PORT, () => {
  console.log(`\u26A1 Neural Swarm running on port ${PORT}`);
  console.log(`   Base URL: ${BASE_URL}`);
});
