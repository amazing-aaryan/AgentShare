/** Static shell only: shared text is inserted through textContent after login. */
export function desktopReviewPage(nonce: string): string {
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentShare — review this chat</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;font:16px system-ui;line-height:1.5}body{max-width:880px;margin:40px auto;padding:0 24px}h1{font-size:2rem}label{display:block;margin:16px 0}select,button{font:inherit;padding:10px 14px;border:1px solid #888;border-radius:8px}select{display:block;min-width:260px}button{cursor:pointer;margin:8px 8px 8px 0}button:disabled{opacity:.5;cursor:default}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:light-dark(#f4f5f7,#20242a);padding:18px;border-radius:10px;max-height:480px;overflow:auto}.muted{opacity:.75}#error{color:light-dark(#a52117,#ffaba4)}[hidden]{display:none!important}#link{display:block;overflow-wrap:anywhere}details{margin:14px 0}summary{cursor:pointer;font-weight:600}.primary{background:#17614b;color:white;border-color:#17614b}input{margin-right:10px}
</style></head><body><h1>Share this chat</h1><p>Choose what to include. Review the exact snapshot before publishing an encrypted link.</p><p id="identity" class="muted"></p><p id="error" role="alert"></p>
<section id="choices"><label>Context<select id="scope"><option value="conversation">Conversation only</option><option value="workspace">Project files only</option><option value="both">Conversation + project files</option></select></label><label>Recipient access<select id="access"><option value="read">Read only</option><option value="read_propose">Read + propose changes</option></select></label><label>Link expires after<select id="ttl"><option value="3600">1 hour</option><option value="86400" selected>24 hours</option><option value="259200">72 hours</option></select></label><button id="prepare" class="primary" disabled>Prepare private preview</button><button id="cancel" disabled>Cancel</button><p class="muted">Nothing is uploaded during preparation. Recipients can retain copies after a link expires or is revoked.</p></section>
<section id="review" hidden><h2>Review before publishing</h2><pre id="summary"></pre><div id="sections"></div><label><input id="reviewed" type="checkbox">I reviewed this snapshot and want to share it with people who receive the link.</label><button id="publish" class="primary" disabled>Publish encrypted share</button><button id="status">Check publication status</button><p class="muted">The relay receives encrypted content. Secret scanning can miss sensitive information; inspect the preview before publishing.</p></section>
<section id="done" hidden><h2 id="doneTitle"></h2><p id="doneText"></p><a id="link" rel="noreferrer"></a><button id="copy" hidden>Copy private link</button></section>
<script nonce="${nonce}">
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let csrf = '', current, locked = false, previewLoaded = false;
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const request = async (path, body) => {
    const response = await fetch('/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-agentshare-csrf': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Review request failed');
    return data;
  };
  const controls = () => {
    const attempted = current?.publicationAttempted === true;
    $('prepare').disabled = !current || locked || attempted;
    $('cancel').disabled = !current || locked || attempted;
    for (const id of ['scope', 'access', 'ttl']) $(id).disabled = locked || attempted;
    $('publish').disabled = locked || !current?.draft || !previewLoaded || !$('reviewed').checked;
  };
  const error = err => { $('error').textContent = err.message; };
  const task = fn => async event => {
    if (!event.isTrusted || locked) return;
    locked = true; controls(); $('error').textContent = '';
    try { await fn(); } catch (err) { error(err); }
    finally { locked = false; controls(); }
  };
  const clearPreview = () => {
    previewLoaded = false; $('review').hidden = true;
    $('summary').textContent = ''; $('sections').replaceChildren();
    $('reviewed').checked = false; $('publish').disabled = true;
    if (current) current = { ...current, draft: undefined };
  };
  const finish = data => {
    $('choices').hidden = true; $('review').hidden = true; $('done').hidden = false;
    $('doneTitle').textContent = data ? 'Encrypted share ready' : 'Cancelled';
    $('doneText').textContent = data
      ? 'Anyone with the complete link can access the selected context. Send it only to intended recipients.'
      : 'No new publication was approved.';
    if (data) {
      $('link').href = data.url; $('link').textContent = data.url; $('copy').hidden = false;
      $('copy').onclick = () => navigator.clipboard.writeText(data.url).catch(error);
    }
  };
  const show = async data => {
    clearPreview(); current = data; csrf = data.csrf;
    if (data.published) { finish(data.published); return; }
    $('identity').textContent = 'Chat ' + data.threadId + ' · ' + data.recordedRoot;
    controls();
    if (!data.draft) return;
    const d = data.draft, p = d.policy, s = d.summary;
    $('review').hidden = false;
    $('summary').textContent = [
      'Context: ' + (p.includeConversation && p.includeWorkspace ? 'Conversation + project files' : p.includeConversation ? 'Conversation only' : 'Project files only'),
      'Access: ' + (p.proposalsEnabled ? 'Read + propose changes' : 'Read only'),
      'Link lifetime: ' + d.ttlSeconds / 3600 + ' hours',
      'Conversation events: ' + s.conversationEvents + ' · Files: ' + s.files,
      'Excluded files: ' + s.excludedFiles + ' · Redactions: ' + s.redactions,
      'Review expires: ' + new Date(d.approvalExpiresAt).toLocaleString(),
      ...(data.publicationAttempted ? ['Publication was attempted. Check status; retry only this same reviewed snapshot.'] : [])
    ].join('\n');
    $('publish').textContent = data.publicationAttempted ? 'Retry exact reviewed share' : 'Publish encrypted share';
    for (const section of ['conversation', 'files', 'exclusions', 'redactions']) {
      const details = document.createElement('details'), title = document.createElement('summary');
      const pre = document.createElement('pre'), more = document.createElement('button');
      title.textContent = section === 'files' ? 'Included files' : section[0].toUpperCase() + section.slice(1);
      more.textContent = 'Load preview'; details.append(title, pre, more); $('sections').append(details);
      let cursor = 0;
      const load = async () => {
        const page = await request('review?section=' + section + '&cursor=' + cursor);
        pre.textContent += page.content; previewLoaded = true;
        if (page.nextCursor === undefined) more.hidden = true;
        else { cursor = page.nextCursor; more.textContent = 'Load more'; }
      };
      more.onclick = task(load);
      if ((section === 'conversation' && p.includeConversation) || (section === 'files' && !p.includeConversation)) {
        details.open = true; await load();
      }
    }
  };
  $('prepare').onclick = task(async () => {
    clearPreview();
    await show(await request('prepare', { scope: $('scope').value, access: $('access').value, ttlSeconds: Number($('ttl').value) }));
  });
  for (const id of ['scope', 'access', 'ttl']) $(id).onchange = () => { clearPreview(); controls(); };
  $('cancel').onclick = task(async () => { await request('cancel', {}); finish(); });
  $('reviewed').onchange = controls;
  $('publish').onclick = task(async () => {
    if (!$('reviewed').checked || !previewLoaded || !current?.draft) return;
    current.publicationAttempted = true;
    try { finish(await request('publish', { draftId: current.draft.draftId, digest: current.draft.digest, nonce: current.nonce })); }
    catch (err) { throw Error(err.message + ' Publication may be incomplete. Keep this page open and check status; do not start another share.'); }
  });
  $('status').onclick = task(async () => show(await request('status')));
  request('session', token ? { token } : undefined).then(show).then(controls).catch(error);
})();
</script></body></html>`;
}
