let allLines = [];

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) readFile(file);
});
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) readFile(e.target.files[0]);
});

function readFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('filenameBar').innerHTML = '📄 <strong>' + file.name + '</strong> &nbsp;·&nbsp; ' + (file.size / 1024).toFixed(1) + ' KB';
    parseLog(e.target.result);
  };
  reader.readAsText(file);
}

function parseTimestamp(ts) {
  const m = ts.match(/(\d+):(\d+):(\d+)\.(\d+)\s+\((\d+)\)/);
  if (!m) return null;
  return { display: m[1] + ':' + m[2] + ':' + m[3] + '.' + m[4], ns: parseInt(m[5]) };
}

function parseLog(text) {
  const lines = text.split('\n').filter(l => l.trim());
  allLines = lines;

  const limits = {};
  const callouts = [];
  const soqls = [];
  const exceptions = [];

  let executionStart = null;
  let executionEnd = null;
  let pendingCallout = null;

  const limitNames = {
    SOQL: ['SOQL queries', 200],
    SOQL_ROWS: ['SOQL rows', 50000],
    DML_STATEMENTS: ['DML statements', 150],
    DML_ROWS: ['DML rows', 10000],
    CPU_TIME: ['CPU time (ms)', 10000],
    HEAP_SIZE: ['Heap size (bytes)', 6000000],
    CALLOUTS: ['Callouts', 100],
    AGGS: ['Aggregate queries', 300],
    QUERY_ROWS: ['Query rows', 50000],
  };

  const soqlMap = {};

  lines.forEach(line => {
    const parts = line.split('|');
    if (parts.length < 2) return;

    const tsStr = parts[0].trim();
    const ts = parseTimestamp(tsStr);
    const event = parts[1];

    if (event === 'EXECUTION_STARTED' && ts) executionStart = ts.ns;
    if (event === 'EXECUTION_FINISHED' && ts) executionEnd = ts.ns;

    if (event === 'LIMIT_USAGE' && parts.length >= 5) {
      const name = parts[3];
      const used = parseInt(parts[4]);
      const max = limitNames[name] ? limitNames[name][1] : null;
      if (!limits[name] || used > limits[name].used) {
        limits[name] = { used, max: max || '—', label: limitNames[name] ? limitNames[name][0] : name };
      }
    }

    if (event === 'CALLOUT_REQUEST' && ts) {
      const detail = parts.slice(3).join('|');
      const endpointMatch = detail.match(/Endpoint=([^,\]]+)/);
      const methodMatch = detail.match(/Method=([^\]]+)/);
      pendingCallout = {
        endpoint: endpointMatch ? endpointMatch[1] : detail,
        method: methodMatch ? methodMatch[1] : 'GET',
        startNs: ts.ns,
        ts: ts.display
      };
    }

    if (event === 'CALLOUT_RESPONSE' && ts && pendingCallout) {
      const detail = parts.slice(3).join('|');
      const statusMatch = detail.match(/Status=([^,\]]+)/);
      const codeMatch = detail.match(/StatusCode=(\d+)/);
      const code = codeMatch ? parseInt(codeMatch[1]) : 0;
      callouts.push({
        ...pendingCallout,
        status: statusMatch ? statusMatch[1] : '—',
        code,
        durationMs: ((ts.ns - pendingCallout.startNs) / 1e6).toFixed(0)
      });
      pendingCallout = null;
    }

    if (event === 'SOQL_EXECUTE_BEGIN' && parts.length >= 5) {
      const lineNum = parts[2].replace(/[[\]]/g, '').trim();
      const query = parts.slice(4).join('|');
      soqlMap[lineNum] = { query, lineNum, rows: '—' };
    }

    if (event === 'SOQL_EXECUTE_END' && parts.length >= 5) {
      const lineNum = parts[2].replace(/[[\]]/g, '').trim();
      const rowMatch = parts.slice(3).join('|').match(/Rows:(\d+)/);
      if (soqlMap[lineNum]) {
        soqlMap[lineNum].rows = rowMatch ? rowMatch[1] : '—';
        soqls.push(soqlMap[lineNum]);
        delete soqlMap[lineNum];
      }
    }

    if ((event === 'EXCEPTION_THROWN' || event === 'FATAL_ERROR') && ts) {
      exceptions.push({ ts: ts.display, type: event, detail: parts.slice(2).join(' | ') });
    }

    if (event === 'SYSTEM_MODE_EXCEPTION' && ts) {
      exceptions.push({ ts: ts.display, type: event, detail: parts.slice(2).join(' | ') });
    }
  });

  const durationMs = executionStart && executionEnd ? ((executionEnd - executionStart) / 1e6).toFixed(0) : '—';

  renderMetrics(durationMs, callouts.length, soqls.length, exceptions.length, limits);
  renderLimits(limits);
  renderCallouts(callouts);
  renderSoqls(soqls);
  renderExceptions(exceptions);
  renderRaw(lines);

  dropZone.style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
}

function renderMetrics(duration, calloutCount, soqlCount, exceptCount, limits) {
  const soqlLimit = limits['SOQL'] || {};
  const soqlUsed = soqlLimit.used || 0;
  const soqlPct = soqlLimit.max ? Math.round(soqlUsed / soqlLimit.max * 100) : 0;

  const cpuLimit = limits['CPU_TIME'] || {};
  const cpuUsed = cpuLimit.used || 0;
  const cpuPct = cpuLimit.max ? Math.round(cpuUsed / cpuLimit.max * 100) : 0;

  const durationClass = duration > 90000 ? 'danger' : duration > 60000 ? 'warn' : 'ok';
  const exClass = exceptCount > 0 ? 'danger' : 'ok';
  const soqlClass = soqlPct > 80 ? 'danger' : soqlPct > 60 ? 'warn' : 'ok';

  document.getElementById('metricsGrid').innerHTML = `
<div class="metric ${durationClass}">
  <div class="label">Execution time</div>
  <div class="value">${duration === '—' ? '—' : (duration > 1000 ? (duration / 1000).toFixed(1) + 's' : duration + 'ms')}</div>
  <div class="sub">120s limit</div>
</div>
<div class="metric">
  <div class="label">Callouts</div>
  <div class="value">${calloutCount}</div>
  <div class="sub">100 limit</div>
</div>
<div class="metric ${soqlClass}">
  <div class="label">SOQL queries</div>
  <div class="value">${soqlCount}</div>
  <div class="sub">${soqlPct}% of limit</div>
</div>
<div class="metric ${exClass}">
  <div class="label">Exceptions</div>
  <div class="value">${exceptCount}</div>
  <div class="sub">${exceptCount === 0 ? 'No errors' : 'Review needed'}</div>
</div>
<div class="metric ${cpuPct > 80 ? 'danger' : cpuPct > 60 ? 'warn' : 'ok'}">
  <div class="label">CPU time</div>
  <div class="value">${cpuUsed ? cpuUsed + 'ms' : '—'}</div>
  <div class="sub">${cpuPct ? cpuPct + '% of 10s limit' : ''}</div>
</div>
`;
}

function renderLimits(limits) {
  const tbody = document.querySelector('#limitsTable tbody');
  if (!Object.keys(limits).length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No limit data found</td></tr>'; return; }
  tbody.innerHTML = Object.entries(limits).map(([key, v]) => {
    const pct = v.max !== '—' ? Math.round(v.used / v.max * 100) : null;
    const cls = pct > 80 ? 'danger' : pct > 60 ? 'warn' : 'ok';
    const fillCls = pct > 80 ? 'fill-danger' : pct > 60 ? 'fill-warn' : 'fill-ok';
    return `<tr>
  <td>${v.label}</td>
  <td><strong>${v.used.toLocaleString()}</strong></td>
  <td>${v.max !== '—' ? v.max.toLocaleString() : '—'}</td>
  <td style="min-width:120px">
    ${pct !== null ? `<span class="pill pill-${cls === 'danger' ? 'red' : cls === 'warn' ? 'amber' : 'green'}">${pct}%</span>
    <div class="progress-bar"><div class="progress-fill ${fillCls}" style="width:${Math.min(pct, 100)}%"></div></div>` : '—'}
  </td>
</tr>`;
  }).join('');
}

function renderCallouts(callouts) {
  const tbody = document.querySelector('#calloutsTable tbody');
  if (!callouts.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No callouts found</td></tr>'; return; }
  tbody.innerHTML = callouts.map((c, i) => {
    const codeClass = c.code >= 400 ? 'pill-red' : c.code >= 300 ? 'pill-amber' : 'pill-green';
    const dClass = c.durationMs > 10000 ? 'pill-amber' : 'pill-gray';
    const url = c.endpoint.length > 70 ? c.endpoint.substring(0, 70) + '…' : c.endpoint;
    return `<tr>
  <td>${i + 1}</td>
  <td style="font-size:12px;font-family:monospace" title="${c.endpoint}">${url}</td>
  <td><span class="pill pill-blue">${c.method}</span></td>
  <td><span class="pill ${codeClass}">${c.code || c.status}</span></td>
  <td><span class="pill ${dClass}">${Number(c.durationMs).toLocaleString()}</span></td>
</tr>`;
  }).join('');
}

function renderSoqls(soqls) {
  const tbody = document.querySelector('#soqlTable tbody');
  if (!soqls.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No SOQL queries found</td></tr>'; return; }
  tbody.innerHTML = soqls.map((s, i) => {
    const rows = parseInt(s.rows);
    const rowClass = rows > 1000 ? 'pill-amber' : rows > 5000 ? 'pill-red' : 'pill-gray';
    const q = s.query.length > 100 ? s.query.substring(0, 100) + '…' : s.query;
    return `<tr>
  <td>${i + 1}</td>
  <td style="font-size:12px;font-family:monospace">${q}</td>
  <td><span class="pill ${rowClass}">${s.rows}</span></td>
  <td style="color:#888">${s.lineNum}</td>
</tr>`;
  }).join('');
}

function renderExceptions(exceptions) {
  const el = document.getElementById('exceptionsList');
  if (!exceptions.length) {
    el.innerHTML = '<div class="empty" style="padding:24px;text-align:center;color:#639922">✓ No exceptions or fatal errors found</div>';
    return;
  }
  el.innerHTML = exceptions.map(e => `
<div class="tl-item">
  <div class="tl-dot tl-dot-red"></div>
  <div class="tl-time">${e.ts}</div>
  <div class="tl-text">
    <span class="pill pill-red">${e.type}</span>
    <small style="margin-top:4px">${e.detail}</small>
  </div>
</div>
`).join('');
}

function renderRaw(lines) {
  const container = document.getElementById('logScroll');
  const entries = lines.map(line => {
    const parts = line.split('|');
    const ts = parts[0] ? parts[0].trim().split(' ')[0] : '';
    const event = parts[1] || '';
    const msg = parts.slice(2).join(' | ');
    return { ts, event, msg, raw: line };
  });
  container._entries = entries;
  renderFilteredLog(entries);
}

function renderFilteredLog(entries) {
  const container = document.getElementById('logScroll');
  const html = entries.slice(0, 500).map(e => `
<div class="log-entry">
  <span class="ts">${e.ts}</span>
  <span class="evt"><span class="pill pill-gray" style="font-size:10px">${e.event}</span></span>
  <span class="msg">${e.msg.substring(0, 200)}</span>
</div>
`).join('');
  container.innerHTML = html + (entries.length > 500 ? `<div class="empty">Showing first 500 of ${entries.length} lines</div>` : '');
}

function filterLog() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const eventFilter = document.getElementById('eventFilter').value;
  const container = document.getElementById('logScroll');
  if (!container._entries) return;
  let entries = container._entries;
  if (eventFilter) entries = entries.filter(e => e.event.includes(eventFilter));
  if (search) entries = entries.filter(e => e.raw.toLowerCase().includes(search));
  renderFilteredLog(entries);
}

function toggleSection(id) {
  const body = document.getElementById(id);
  const toggleId = id.replace('Body', 'Toggle');
  const toggle = document.getElementById(toggleId);
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    if (toggle) toggle.textContent = '▼';
  } else {
    body.classList.add('collapsed');
    if (toggle) toggle.textContent = '▶';
  }
}
