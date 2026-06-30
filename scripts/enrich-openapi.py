#!/usr/bin/env python3
"""
enrich-openapi.py — Phase 1+ of the self-describing-SDK effort.

Writes doc-grounded metadata (enum / description / required) BACK into
openapi.yaml so the spec becomes the single source of truth. It is:

  * Format-preserving: targeted line insertions only (a full PyYAML re-dump
    rewrites quoting on every line — 2000+ lines of noise — so we never do that).
  * Idempotent: skips a field that already has enum/description, and a schema
    that already has a `required:` array, so re-runs (and later phases) are safe.
  * Additive only: never deletes or moves a field, never changes a method.
    (Phase-1 judgment calls: getSubDepositRecords stays GET — spec is the
    live-verified truth; placeStrategyOrder gets enum/required only, NO trigger
    fields — official doc documents type=tpsl only; transfer.allowBorrow stays.)

Enum values are emitted JSON-quoted so YAML 1.1 cannot reinterpret `yes`/`no`/
`on`/`off` as booleans (PyYAML loads this file downstream).

Usage:
  python3 scripts/enrich-openapi.py --dry-run        # Phase-1 domains, preview
  python3 scripts/enrich-openapi.py                  # Phase-1 domains, write
  python3 scripts/enrich-openapi.py --all [--dry-run] # every /api/v3 op
"""
import sys, re, json, subprocess, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SPEC = os.path.join(ROOT, "openapi.yaml")
MJS = os.path.join(HERE, "extract-doc-metadata.mjs")

PHASE1_PREFIXES = (
    "/api/v3/account/",
    "/api/v3/user/",
    "/api/v3/market/",
    "/api/v3/trade/",
    "/api/v3/position/",
)


def indent(line):
    return len(line) - len(line.lstrip(" "))


def yq(s):
    # JSON strings are valid YAML double-quoted scalars; this neutralises the
    # yes/no/on/off boolean trap and escapes quotes/unicode safely.
    return json.dumps(s, ensure_ascii=False)


def load_docs():
    out = subprocess.check_output(["node", MJS, "json"], cwd=ROOT).decode("utf-8")
    return {d["key"]: d for d in json.loads(out)}


def load_spec():
    import yaml

    return yaml.safe_load(open(SPEC))


def block_end(lines, start, header_indent):
    for j in range(start + 1, len(lines)):
        if lines[j].strip() == "":
            continue
        if indent(lines[j]) <= header_indent:
            return j
    return len(lines)


def find_schema(lines, name):
    pat = re.compile(r"^    " + re.escape(name) + r":\s*$")
    for i, l in enumerate(lines):
        if pat.match(l):
            return i, block_end(lines, i, 4)
    return None


def find_path_method(lines, path, method):
    ppat = re.compile(r"^  " + re.escape(path) + r":\s*$")
    mpat = re.compile(r"^    " + method + r":\s*$")
    for i, l in enumerate(lines):
        if ppat.match(l):
            pend = block_end(lines, i, 2)
            for j in range(i + 1, pend):
                if mpat.match(lines[j]):
                    return j, block_end(lines, j, 4)
    return None


def enrich_body(lines, sstart, send, doc, edits, replaces, stat):
    dmap = {p["name"]: p for p in doc["params"]}
    req = [p["name"] for p in doc["params"] if p["required"]]

    type_obj_idx = None
    has_required = False
    prop_idx = None
    for k in range(sstart, send):
        if type_obj_idx is None and re.match(r"^      type: object\s*$", lines[k]):
            type_obj_idx = k
        if re.match(r"^      required:", lines[k]):
            has_required = True
        if prop_idx is None and re.match(r"^      properties:\s*$", lines[k]):
            prop_idx = k

    if req and not has_required and type_obj_idx is not None:
        # only require props that actually exist as spec properties
        present = [n for n in req if any(re.match(r"^        " + re.escape(n) + r":\s*$", lines[k]) for k in range(prop_idx, send))] if prop_idx else []
        if present:
            edits.append((type_obj_idx, ["      required: [" + ", ".join(yq(n) for n in present) + "]"]))
            stat["required"] += 1

    if prop_idx is None:
        return
    pend = block_end(lines, prop_idx, 6)
    k = prop_idx + 1
    while k < pend:
        m = re.match(r"^        (\w+):\s*$", lines[k])
        if not m:
            k += 1
            continue
        pname = m.group(1)
        psub_end = block_end(lines, k, 8)
        dp = dmap.get(pname)
        if dp:
            type_idx = None
            has_enum = has_desc = False
            for j in range(k + 1, psub_end):
                if re.match(r"^          type:", lines[j]):
                    type_idx = j
                elif re.match(r"^          enum:", lines[j]):
                    has_enum = True
                elif re.match(r"^          description:", lines[j]):
                    has_desc = True
            ins = []
            if dp.get("enum") and not has_enum:
                ins.append("          enum:")
                ins += ["          - " + yq(v) for v in dp["enum"]]
                stat["enum"] += 1
            if dp.get("description") and not has_desc:
                ins.append("          description: " + yq(dp["description"]))
                stat["desc"] += 1
            if ins and type_idx is not None:
                edits.append((type_idx, ins))
        k = psub_end


def enrich_query(lines, mstart, mend, doc, edits, replaces, stat):
    dmap = {p["name"]: p for p in doc["params"]}
    par_idx = None
    for k in range(mstart, mend):
        if re.match(r"^      parameters:\s*$", lines[k]):
            par_idx = k
            break
    if par_idx is None:
        return
    # parameters: is a YAML sequence whose `- name:` items sit at the SAME
    # indent (6) as the key, so the shared block_end (indent<=6 => stop) would
    # terminate on the first item. Walk to the next indent<6 line, or the next
    # indent==6 line that is NOT a list dash (e.g. `      responses:`).
    pend = par_idx + 1
    while pend < len(lines):
        s = lines[pend]
        if s.strip() == "":
            pend += 1
            continue
        ind = indent(s)
        if ind < 6 or (ind == 6 and not s.lstrip(" ").startswith("- ")):
            break
        pend += 1
    k = par_idx + 1
    while k < pend:
        m = re.match(r"^      - name: (\w+)\s*$", lines[k])
        if not m:
            k += 1
            continue
        pname = m.group(1)
        sub_end = k + 1
        while sub_end < pend:
            if re.match(r"^      - ", lines[sub_end]):
                break
            if lines[sub_end].strip() and indent(lines[sub_end]) <= 6:
                break
            sub_end += 1
        dp = dmap.get(pname)
        if dp:
            in_idx = req_idx = schema_type_idx = None
            has_enum = has_desc = False
            for j in range(k + 1, sub_end):
                if re.match(r"^        in:", lines[j]):
                    in_idx = j
                elif re.match(r"^        required:", lines[j]):
                    req_idx = j
                elif re.match(r"^        description:", lines[j]):
                    has_desc = True
                elif re.match(r"^          type:", lines[j]):
                    schema_type_idx = j
                elif re.match(r"^          enum:", lines[j]):
                    has_enum = True
            if req_idx is not None and dp["required"] and re.search(r"required:\s*false", lines[req_idx]):
                replaces.append((req_idx, "        required: true"))
                stat["required"] += 1
            if dp.get("enum") and not has_enum and schema_type_idx is not None:
                ins = ["          enum:"] + ["          - " + yq(v) for v in dp["enum"]]
                edits.append((schema_type_idx, ins))
                stat["enum"] += 1
            if dp.get("description") and not has_desc and in_idx is not None:
                edits.append((in_idx, ["        description: " + yq(dp["description"])]))
                stat["desc"] += 1
        k = sub_end


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    prefixes = None if "--all" in args else PHASE1_PREFIXES

    docs = load_docs()
    spec = load_spec()
    text = open(SPEC).read()
    lines = text.split("\n")

    edits, replaces = [], []
    stat = {"enum": 0, "desc": 0, "required": 0}
    touched = []

    for path, item in spec["paths"].items():
        if prefixes and not path.startswith(prefixes):
            continue
        for method, op in item.items():
            if method not in ("get", "post", "put", "delete", "patch"):
                continue
            key = f"{method.upper()} {path}"
            doc = docs.get(key)
            if not doc:
                continue
            before = dict(stat)
            rb = op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema", {})
            ref = rb.get("$ref")
            if ref:
                loc = find_schema(lines, ref.split("/")[-1])
                if loc:
                    enrich_body(lines, loc[0], loc[1], doc, edits, replaces, stat)
            if any(p.get("in") == "query" for p in op.get("parameters", []) or []):
                loc = find_path_method(lines, path, method)
                if loc:
                    enrich_query(lines, loc[0], loc[1], doc, edits, replaces, stat)
            d = {k2: stat[k2] - before[k2] for k2 in stat}
            if any(d.values()):
                touched.append((op.get("operationId", key), d))

    # Apply replaces then inserts, bottom-up so original indices stay valid.
    for idx, newline in sorted(replaces, key=lambda x: -x[0]):
        lines[idx] = newline
    for idx, newlines in sorted(edits, key=lambda x: -x[0]):
        lines[idx + 1 : idx + 1] = newlines

    print(f"ops touched: {len(touched)} | inserts: {len(edits)} | replaces: {len(replaces)}")
    print(f"totals -> enum:{stat['enum']} description:{stat['desc']} required:{stat['required']}")
    for opid, d in touched:
        print(f"  {opid:34} enum+{d['enum']} desc+{d['desc']} req+{d['required']}")

    if dry:
        print("\n[dry-run] no file written.")
        return
    open(SPEC, "w").write("\n".join(lines))
    print(f"\nwrote {SPEC}")


if __name__ == "__main__":
    main()
