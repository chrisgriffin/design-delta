/**
 * decisions-page.mjs — the page an owner answers decisions on (issue #62).
 *
 * One self-contained HTML document: inline style and script, no font, image,
 * stylesheet or script fetched from anywhere. It reads without its script
 * (every decision, option and recommendation is server-rendered markup), and
 * the script only collects the answers:
 *
 *   - `serve` mode posts them to the `design-delta decide` that served the
 *     page, with the run's token, and shows what was written;
 *   - `static` mode (`decide --no-serve`) saves them as an answers file for
 *     `design-delta decide --apply <file>`.
 *
 * Every decision opens on its recommended answer. "Decide later" leaves it
 * out of the save. `accept` and `waive` need a reason and `track` an issue
 * reference before the page will save, the same checks `applyAnswers`
 * makes, so a refusal is seen on the page rather than after it.
 *
 * Pure and deterministic: the same input renders the same bytes.
 *
 * `core/`: imports nothing outside `core/`.
 */

const ANSWER_LABELS = {
  "fix-code": "Fix the code",
  "change-contract": "Change the contract",
  "change-design": "Change the design",
  accept: "Accept it: correct by design",
  waive: "Waive it: leave it unfixed",
  track: "Track it in an issue",
  "remove-exemption": "Remove the exemption",
}

const PILE_LABELS = {
  contract: "Contract",
  design: "Design file",
  "tokens-config": "Tokens and config",
  review: "Needs a person",
}

const escapeHtml = value =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

/** JSON safe inside a `<script>` element: nothing in it can close the tag. */
const embedJson = value =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")

function renderDecision(decision, index) {
  const name = `d${index}`
  const multi = decision.entities.length > 1
  const answered = decision.answered?.[0]
  const initial = answered?.answer || decision.recommended

  const entities = multi
    ? `<fieldset class="entities"><legend>Applies to (${decision.entities.length})</legend>${decision.entities
        .map(
          (key, i) =>
            `<label><input type="checkbox" name="${name}-entity" value="${escapeHtml(key)}" checked id="${name}-e${i}"> <code>${escapeHtml(key)}</code></label>`,
        )
        .join("")}</fieldset>`
    : `<p class="entity">Applies to <code>${escapeHtml(decision.entities[0])}</code></p>`

  const messages = decision.items
    .map(
      item =>
        `<li><code>${escapeHtml(item.key)}</code>: ${escapeHtml(item.message)}</li>`,
    )
    .join("")

  const options = [...decision.options, "later"]
    .map(option => {
      const label =
        option === "later" ? "Decide later" : ANSWER_LABELS[option] || option
      const recommended =
        option === decision.recommended
          ? ' <span class="badge">Recommended</span>'
          : ""
      return `<label class="option"><input type="radio" name="${name}-answer" value="${option}"${option === initial ? " checked" : ""}> ${escapeHtml(label)}${recommended}</label>`
    })
    .join("")

  const answeredNote = answered
    ? `<p class="answered">Already answered: <strong>${escapeHtml(ANSWER_LABELS[answered.answer] || answered.answer)}</strong>${answered.note ? `, "${escapeHtml(answered.note)}"` : ""}. Waiting for that change; pick again to change the answer.</p>`
    : ""

  return `<section class="decision" data-id="${escapeHtml(decision.id)}" data-name="${name}" aria-labelledby="${name}-title">
<h2 id="${name}-title"><code>${escapeHtml(decision.ruleId)}</code></h2>
<p class="meta"><span class="pile">${escapeHtml(PILE_LABELS[decision.pile] || decision.pile)}</span> · <span class="severity severity-${escapeHtml(decision.severity)}">${escapeHtml(decision.severity)}</span> · ${decision.items.length} finding${decision.items.length === 1 ? "" : "s"}</p>
${answeredNote}
<details${decision.items.length <= 3 ? " open" : ""}><summary>What the audit found</summary><ul>${messages}</ul></details>
${entities}
<p class="recommendation"><strong>Recommended: ${escapeHtml(ANSWER_LABELS[decision.recommended] || decision.recommended)}.</strong> ${escapeHtml(decision.reason)}</p>
<fieldset class="answers"><legend>Your answer</legend>${options}</fieldset>
<div class="fields">
<label for="${name}-reason">Reason <span class="hint">(needed to accept or waive)</span></label>
<input type="text" id="${name}-reason" name="${name}-reason">
<label for="${name}-issue">Issue <span class="hint">(needed to track)</span></label>
<input type="text" id="${name}-issue" name="${name}-issue" placeholder="owner/repo#12 or a link">
<label for="${name}-note">Note for whoever makes the change</label>
<textarea id="${name}-note" name="${name}-note" rows="2"></textarea>
</div>
<p class="error" id="${name}-error" role="alert"></p>
</section>`
}

const STYLE = `
:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#5d5d58;--line:#dcdcd6;--card:#fff;--accent:#2f5bd3;--ok:#1f7a4d;--err:#b3261e;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ececea;--muted:#a3a39d;--line:#34342f;--card:#1d1d1b;--accent:#8fadff;--ok:#6fd3a0;--err:#ff8a80;--warn:#f0c060}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:52rem;margin:0 auto;padding:2rem 1rem 6rem}
h1{font-size:1.6rem;margin:0 0 .25rem}
h2{font-size:1.05rem;margin:0}
code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.lede,.meta,.hint{color:var(--muted)}
.decision{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem 1.25rem;margin:1rem 0}
.badge{display:inline-block;font-size:.75rem;font-weight:600;padding:0 .5rem;border-radius:999px;background:var(--accent);color:var(--bg)}
.severity-error{color:var(--err)}.severity-warn{color:var(--warn)}
fieldset{border:0;padding:0;margin:.75rem 0}
legend{font-weight:600;margin-bottom:.25rem}
.option,.entities label{display:block;padding:.2rem 0}
.fields{display:grid;gap:.25rem;margin:.5rem 0}
input[type=text],textarea{width:100%;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:.4rem .5rem}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.error{color:var(--err);margin:0}
.answered{color:var(--ok)}
.bar{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--line);padding:1rem;display:flex;gap:1rem;align-items:center;justify-content:center;flex-wrap:wrap}
button{font:inherit;font-weight:600;padding:.6rem 1.2rem;border-radius:8px;border:0;background:var(--accent);color:var(--bg);cursor:pointer}
#status{margin:0}
`

const SCRIPT = `
(function(){
var data=JSON.parse(document.getElementById("dd-data").textContent);
var status=document.getElementById("status");
function collect(){
  var answers=[],ok=true;
  document.querySelectorAll(".decision").forEach(function(section){
    var n=section.dataset.name,err=document.getElementById(n+"-error");err.textContent="";
    var picked=section.querySelector('input[name="'+n+'-answer"]:checked');
    if(!picked||picked.value==="later")return;
    var a={id:section.dataset.id,answer:picked.value};
    var boxes=section.querySelectorAll('input[name="'+n+'-entity"]');
    if(boxes.length){var e=[];boxes.forEach(function(b){if(b.checked)e.push(b.value)});
      if(!e.length){err.textContent="Select at least one entity, or choose Decide later.";ok=false;return}
      if(e.length<boxes.length)a.entities=e}
    var reason=document.getElementById(n+"-reason").value.trim(),issue=document.getElementById(n+"-issue").value.trim(),note=document.getElementById(n+"-note").value.trim();
    if(reason)a.reason=reason;if(issue)a.issue=issue;if(note)a.note=note;
    if((a.answer==="accept"||a.answer==="waive")&&!reason){err.textContent="Add a reason to "+a.answer+" this.";ok=false;return}
    if(a.answer==="track"&&!issue){err.textContent="Add the issue that tracks this.";ok=false;return}
    answers.push(a)});
  return ok?{version:1,answers:answers}:null}
document.getElementById("save").addEventListener("click",function(){
  var doc=collect();
  if(!doc){status.textContent="Some answers need a reason or an issue. See the messages above.";return}
  if(!doc.answers.length){status.textContent="Nothing to save: every decision is set to Decide later.";return}
  if(data.mode==="serve"){
    status.textContent="Saving…";
    fetch("/answers",{method:"POST",headers:{"content-type":"application/json","x-design-delta-token":data.token},body:JSON.stringify(doc)})
      .then(function(r){return r.json().then(function(b){return{ok:r.ok,body:b}})})
      .then(function(r){status.textContent=r.ok?"Saved "+r.body.written.length+" answer(s). You can close this page.":"Not saved: "+(r.body.errors||[]).join(" ")})
      .catch(function(){status.textContent="Not saved: the decide command is no longer running. Run it again."});
  }else{
    var url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)+"\\n"],{type:"application/json"}));
    var link=document.createElement("a");link.href=url;link.download="design-delta-answers.json";document.body.appendChild(link);link.click();link.remove();
    status.textContent="Saved design-delta-answers.json. Apply it with: npx design-delta decide --apply design-delta-answers.json";
  }
});
})();
`

/**
 * Render the decision page.
 *
 * @param {object} input
 * @param {object[]} input.decisions from `buildDecisions`
 * @param {number} input.codeCount findings the resolve skill can clear in code
 * @param {object[]} [input.done] decisions-file entries now done
 * @param {string[]} [input.snapshots] when each design snapshot was gathered
 * @param {"serve"|"static"} input.mode
 * @param {string} [input.token] the run's token, `serve` mode only
 * @param {string} [input.generatedAt] when the audit ran
 * @returns {string}
 */
export function renderDecisionsPage({
  decisions,
  codeCount,
  done = [],
  snapshots = [],
  mode,
  token,
  generatedAt,
}) {
  const count = decisions.length
  const summary =
    count === 0
      ? "Nothing is waiting on you."
      : `${count} decision${count === 1 ? "" : "s"} waiting on you.`
  const code =
    codeCount > 0
      ? `<p>${codeCount} more finding${codeCount === 1 ? "" : "s"} can be fixed in code without a decision. The resolve skill clears ${codeCount === 1 ? "it" : "them"}.</p>`
      : ""
  const doneNote =
    done.length > 0
      ? `<p class="answered">${done.length} earlier answer${done.length === 1 ? " has" : "s have"} been carried out; ${done.length === 1 ? "it is" : "they are"} removed from the decisions file on the next save.</p>`
      : ""
  const hasDesign = decisions.some(d => d.pile === "design")
  const snapshotNote =
    hasDesign && snapshots.length > 0
      ? `<p class="hint">Design-side findings come from a snapshot gathered ${snapshots.map(escapeHtml).join(", ")}. If the design file changed since, gather again before answering them.</p>`
      : hasDesign
        ? `<p class="hint">Design-side findings come from a snapshot with no recorded date. Gather it again before trusting them.</p>`
        : ""
  const how =
    mode === "serve"
      ? "Saving writes your answers into this project and stops the decide command."
      : "Saving downloads an answers file. Apply it in the project with <code>npx design-delta decide --apply &lt;file&gt;</code>."

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>design-delta decisions</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Decisions</h1>
<p class="lede">${summary}${generatedAt ? ` From the audit run ${escapeHtml(generatedAt)}.` : ""}</p>
${code}${doneNote}${snapshotNote}
<p class="hint">Each decision starts on its recommended answer. ${how}</p>
${decisions.map(renderDecision).join("\n")}
</main>
<div class="bar"><button type="button" id="save"${count === 0 ? " disabled" : ""}>Save answers</button><p id="status" role="status" aria-live="polite"></p></div>
<script type="application/json" id="dd-data">${embedJson({ mode, ...(mode === "serve" ? { token } : {}) })}</script>
<script>${SCRIPT}</script>
</body>
</html>
`
}
