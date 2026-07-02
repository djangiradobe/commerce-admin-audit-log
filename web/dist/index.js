// web/src/index.js
import { configureWeb } from "@adobedjangir/commerce-admin-management/web";

// web/src/AuditLog.js
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Flex,
  Heading,
  Text,
  TextField,
  Picker,
  Item,
  Button,
  SearchField,
  ProgressCircle,
  Well,
  StatusLight,
  DialogTrigger,
  Dialog,
  Content,
  Header,
  Divider,
  ButtonGroup,
  Checkbox
} from "@adobe/react-spectrum";
import { callAction, resolveActor } from "@adobedjangir/commerce-admin-management/web";
import { getActionKey, getUserRoleProvider } from "@adobedjangir/commerce-admin-management/web";
import { PALETTE, RADIUS, SHADOW } from "@adobedjangir/commerce-admin-management/web";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var PAGE_SIZE_OPTIONS = [
  { id: "25", label: "25 / page" },
  { id: "50", label: "50 / page" },
  { id: "100", label: "100 / page" },
  { id: "200", label: "200 / page" }
];
var DEFAULT_PAGE_SIZE = 50;
var SENSITIVE_TOKEN = "[ENCRYPTED]";
var USE_DEFAULT_SENTINEL = "__USE_DEFAULT__";
var ACTION_OPTIONS = [
  { id: "any", label: "Any action" },
  { id: "create", label: "Create" },
  { id: "update", label: "Update" },
  { id: "delete", label: "Delete" }
];
var SCOPE_OPTIONS = [
  { id: "any", label: "Any scope" },
  { id: "default", label: "Default" },
  { id: "websites", label: "Websites" },
  { id: "stores", label: "Stores" }
];
function actionTone(a) {
  if (a === "create") return "positive";
  if (a === "delete") return "negative";
  if (a === "update") return "notice";
  return "neutral";
}
function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch (_) {
    return iso;
  }
}
function fmtValue(v) {
  if (v == null) return "\u2205";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}
function buildRevertPayload(row) {
  if (!row || !row.path) {
    return { ok: false, message: "Audit row is malformed." };
  }
  if (row.oldValue === SENSITIVE_TOKEN || row.newValue === SENSITIVE_TOKEN) {
    return {
      ok: false,
      message: "This change is for a sensitive (encrypted) field \u2014 the original value is not stored in the audit log, so it cannot be reverted from here."
    };
  }
  if (row.action === "create" || row.oldValue == null) {
    return {
      ok: true,
      payload: {
        values: { [row.path]: USE_DEFAULT_SENTINEL },
        scope: row.scope || "default",
        scopeId: row.scope_id || "0"
      }
    };
  }
  return {
    ok: true,
    payload: {
      values: { [row.path]: row.oldValue },
      scope: row.scope || "default",
      scopeId: row.scope_id || "0"
    }
  };
}
function AuditLog({ runtime, ims }) {
  const useRole = getUserRoleProvider();
  const { role: userRole } = useRole({ runtime, ims });
  const canRevert = (userRole || "admin") === "admin";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [returned, setReturned] = useState(0);
  const [status, setStatus] = useState({ tone: "neutral", message: "" });
  const [confirmRow, setConfirmRow] = useState(null);
  const [reverting, setReverting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => /* @__PURE__ */ new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [scope, setScope] = useState("any");
  const [actionFilter, setActionFilter] = useState("any");
  const [pathFilter, setPathFilter] = useState("");
  const [actor, setActor] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const fetchPage = useCallback(async (nextPage = 0, sizeOverride = null) => {
    var _a;
    const size = sizeOverride || pageSize;
    setLoading(true);
    setError(null);
    try {
      const params = { limit: size, skip: nextPage * size };
      if (scope !== "any") params.scope = scope;
      if (actionFilter !== "any") params.action = actionFilter;
      if (pathFilter.trim()) params.path = pathFilter.trim();
      if (actor.trim()) params.actor = actor.trim();
      if (since.trim()) params.since = since.trim();
      if (until.trim()) params.until = until.trim();
      const res = await callAction(
        { runtime, ims },
        getActionKey("systemConfigAuditList"),
        "",
        params
      );
      const body = (res == null ? void 0 : res.body) || res;
      const next = Array.isArray(body == null ? void 0 : body.items) ? body.items : [];
      setItems(next);
      setReturned((_a = body == null ? void 0 : body.returned) != null ? _a : next.length);
      setPage(nextPage);
    } catch (e) {
      setError(e.message || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [runtime, ims, scope, actionFilter, pathFilter, actor, since, until, pageSize]);
  useEffect(() => {
    fetchPage(0);
  }, []);
  const onSearch = () => fetchPage(0);
  const onPrev = () => {
    if (page > 0) fetchPage(page - 1);
  };
  const onNext = () => {
    if (returned >= pageSize) fetchPage(page + 1);
  };
  const onChangePageSize = (next) => {
    const n = Number(next) || DEFAULT_PAGE_SIZE;
    setPageSize(n);
    fetchPage(0, n);
  };
  const hasNext = returned >= pageSize;
  const hasPrev = page > 0;
  const Pagination = () => /* @__PURE__ */ jsx(
    View,
    {
      paddingX: "size-200",
      paddingY: "size-150",
      UNSAFE_style: {
        background: PALETTE.surfaceMuted,
        borderBottom: `1px solid ${PALETTE.border}`
      },
      children: /* @__PURE__ */ jsxs(Flex, { gap: "size-200", alignItems: "center", justifyContent: "space-between", wrap: true, children: [
        /* @__PURE__ */ jsxs(Flex, { gap: "size-150", alignItems: "center", wrap: true, children: [
          /* @__PURE__ */ jsx(
            Picker,
            {
              "aria-label": "Rows per page",
              selectedKey: String(pageSize),
              onSelectionChange: onChangePageSize,
              width: "size-1700",
              isDisabled: loading,
              children: PAGE_SIZE_OPTIONS.map((o) => /* @__PURE__ */ jsx(Item, { children: o.label }, o.id))
            }
          ),
          /* @__PURE__ */ jsx(Text, { UNSAFE_style: { color: PALETTE.textMuted, fontSize: 12 }, children: items.length === 0 ? "No rows" : /* @__PURE__ */ jsxs(Fragment, { children: [
            "Page ",
            /* @__PURE__ */ jsx("strong", { children: page + 1 }),
            " \xB7 showing rows ",
            page * pageSize + 1,
            "\u2013",
            page * pageSize + returned
          ] }) })
        ] }),
        /* @__PURE__ */ jsxs(Flex, { gap: "size-100", children: [
          /* @__PURE__ */ jsx(Button, { variant: "secondary", onPress: onPrev, isDisabled: !hasPrev || loading, children: "\u2190 Prev" }),
          /* @__PURE__ */ jsx(Button, { variant: "secondary", onPress: onNext, isDisabled: !hasNext || loading, children: "Next \u2192" })
        ] })
      ] })
    }
  );
  const doRevert = useCallback(async (row) => {
    const built = buildRevertPayload(row);
    if (!built.ok) {
      setStatus({ tone: "negative", message: built.message });
      setConfirmRow(null);
      return;
    }
    const baseActor = resolveActor(ims);
    const tagged = row.changedAt ? `${baseActor} (revert of ${row.changedAt})` : baseActor;
    setReverting(true);
    setStatus({ tone: "notice", message: "Reverting\u2026" });
    try {
      const res = await callAction(
        { runtime, ims },
        getActionKey("systemConfigSave"),
        "",
        { ...built.payload, actor: tagged }
      );
      const body = (res == null ? void 0 : res.body) || res;
      if (body && body.fieldErrors) {
        const first = Object.values(body.fieldErrors)[0];
        setStatus({ tone: "negative", message: first || "Revert rejected by validation" });
      } else {
        setStatus({
          tone: "positive",
          message: `Reverted ${row.path} at ${row.scope}:${row.scope_id}`
        });
        await fetchPage(0);
      }
    } catch (e) {
      setStatus({ tone: "negative", message: e.message || "Revert failed" });
    } finally {
      setReverting(false);
      setConfirmRow(null);
    }
  }, [runtime, ims, fetchPage]);
  const startRevert = (row) => {
    const built = buildRevertPayload(row);
    if (!built.ok) {
      setStatus({ tone: "negative", message: built.message });
      return;
    }
    setStatus({ tone: "neutral", message: "" });
    setConfirmRow(row);
  };
  const rowId = (row) => row._id || `${row.changedAt}-${row.path}`;
  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allVisibleSelected = items.length > 0 && items.every((r) => selectedIds.has(rowId(r)));
  const toggleSelectAll = () => setSelectedIds((prev) => {
    if (allVisibleSelected) return /* @__PURE__ */ new Set();
    return new Set(items.map(rowId));
  });
  const runDelete = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return;
    setDeleting(true);
    setStatus({ tone: "notice", message: `Deleting ${ids.length} entr${ids.length === 1 ? "y" : "ies"}\u2026` });
    try {
      const res = await callAction({ runtime, ims }, getActionKey("systemConfigAuditDelete"), "", { ids });
      const body = (res == null ? void 0 : res.body) || res;
      if (body && body.ok) {
        setStatus({ tone: "positive", message: `Deleted ${body.deleted} of ${body.requested}` });
        setSelectedIds(/* @__PURE__ */ new Set());
        await fetchPage(0);
      } else {
        setStatus({ tone: "negative", message: body && body.error || "Delete failed" });
      }
    } catch (e) {
      setStatus({ tone: "negative", message: e.message || "Delete failed" });
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }, [runtime, ims, fetchPage]);
  const GRID = canRevert ? "40px minmax(140px, 180px) minmax(120px, 200px) 110px minmax(180px, 1.2fr) minmax(180px, 1.5fr) minmax(180px, 1.5fr) 180px" : "minmax(140px, 180px) minmax(120px, 200px) 110px minmax(180px, 1.2fr) minmax(180px, 1.5fr) minmax(180px, 1.5fr) 100px";
  return /* @__PURE__ */ jsxs(View, { padding: "size-400", UNSAFE_style: { background: PALETTE.bg, minHeight: "100vh" }, children: [
    /* @__PURE__ */ jsx(Heading, { level: 2, marginTop: 0, children: "Audit Log" }),
    /* @__PURE__ */ jsxs(Text, { UNSAFE_style: { color: PALETTE.textMuted }, children: [
      "Every save to system_config_data is recorded here with old \u2192 new values. Sensitive fields show ",
      /* @__PURE__ */ jsx("code", { children: "[ENCRYPTED]" }),
      " and cannot be reverted from here. Newest entries first."
    ] }),
    status.message && /* @__PURE__ */ jsx(View, { marginTop: "size-150", children: /* @__PURE__ */ jsx(StatusLight, { variant: status.tone, children: status.message }) }),
    /* @__PURE__ */ jsx(
      View,
      {
        marginTop: "size-200",
        padding: "size-200",
        UNSAFE_style: {
          background: PALETTE.surface,
          border: `1px solid ${PALETTE.border}`,
          borderRadius: RADIUS.lg,
          boxShadow: SHADOW.xs
        },
        children: /* @__PURE__ */ jsxs(Flex, { gap: "size-150", wrap: true, alignItems: "end", children: [
          /* @__PURE__ */ jsx(Picker, { label: "Scope", selectedKey: scope, onSelectionChange: setScope, width: "size-1700", children: SCOPE_OPTIONS.map((s) => /* @__PURE__ */ jsx(Item, { children: s.label }, s.id)) }),
          /* @__PURE__ */ jsx(Picker, { label: "Action", selectedKey: actionFilter, onSelectionChange: setActionFilter, width: "size-1700", children: ACTION_OPTIONS.map((s) => /* @__PURE__ */ jsx(Item, { children: s.label }, s.id)) }),
          /* @__PURE__ */ jsx(
            SearchField,
            {
              label: "Path contains",
              value: pathFilter,
              onChange: setPathFilter,
              onSubmit: onSearch,
              width: "size-2400",
              placeholder: "section/group/field"
            }
          ),
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: "Actor",
              value: actor,
              onChange: setActor,
              width: "size-2400",
              placeholder: "email or org id"
            }
          ),
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: "Since (ISO)",
              value: since,
              onChange: setSince,
              width: "size-2400",
              placeholder: "2026-01-01T00:00:00Z"
            }
          ),
          /* @__PURE__ */ jsx(
            TextField,
            {
              label: "Until (ISO)",
              value: until,
              onChange: setUntil,
              width: "size-2400",
              placeholder: "2026-12-31T23:59:59Z"
            }
          ),
          /* @__PURE__ */ jsx(Button, { variant: "cta", onPress: onSearch, isDisabled: loading, children: loading ? "Loading\u2026" : "Search" })
        ] })
      }
    ),
    error && /* @__PURE__ */ jsx(Well, { marginTop: "size-200", UNSAFE_style: { borderColor: PALETTE.danger }, children: /* @__PURE__ */ jsx(Text, { UNSAFE_style: { color: PALETTE.danger }, children: error }) }),
    /* @__PURE__ */ jsxs(
      View,
      {
        marginTop: "size-200",
        UNSAFE_style: {
          background: PALETTE.surface,
          border: `1px solid ${PALETTE.border}`,
          borderRadius: RADIUS.lg,
          boxShadow: SHADOW.xs,
          overflow: "hidden"
        },
        children: [
          /* @__PURE__ */ jsx(Pagination, {}),
          canRevert && selectedIds.size > 0 && /* @__PURE__ */ jsx(View, { paddingX: "size-200", paddingY: "size-100", UNSAFE_style: { background: PALETTE.surfaceMuted, borderBottom: `1px solid ${PALETTE.border}` }, children: /* @__PURE__ */ jsxs(Flex, { gap: "size-150", alignItems: "center", children: [
            /* @__PURE__ */ jsxs(Text, { UNSAFE_style: { fontSize: 12, fontWeight: 600 }, children: [
              selectedIds.size,
              " selected"
            ] }),
            /* @__PURE__ */ jsx(Button, { variant: "negative", onPress: () => setConfirmDelete({ ids: Array.from(selectedIds) }), isDisabled: deleting, children: "Delete selected" }),
            /* @__PURE__ */ jsx(Button, { variant: "secondary", isQuiet: true, onPress: () => setSelectedIds(/* @__PURE__ */ new Set()), isDisabled: deleting, children: "Clear" })
          ] }) }),
          /* @__PURE__ */ jsxs("div", { style: {
            display: "grid",
            gridTemplateColumns: GRID,
            padding: "12px 16px",
            gap: 12,
            background: PALETTE.surfaceMuted,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: PALETTE.textMuted,
            borderBottom: `1px solid ${PALETTE.border}`
          }, children: [
            canRevert && /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(Checkbox, { "aria-label": "Select all", isSelected: allVisibleSelected, onChange: toggleSelectAll, isDisabled: deleting }) }),
            /* @__PURE__ */ jsx("div", { children: "Time" }),
            /* @__PURE__ */ jsx("div", { children: "Actor" }),
            /* @__PURE__ */ jsx("div", { style: { paddingLeft: 22 }, children: "Action" }),
            /* @__PURE__ */ jsx("div", { children: "Path" }),
            /* @__PURE__ */ jsx("div", { children: "Old" }),
            /* @__PURE__ */ jsx("div", { children: "New" }),
            /* @__PURE__ */ jsx("div", { children: "Actions" })
          ] }),
          loading && items.length === 0 ? /* @__PURE__ */ jsx(Flex, { justifyContent: "center", margin: "size-400", children: /* @__PURE__ */ jsx(ProgressCircle, { "aria-label": "Loading", isIndeterminate: true }) }) : items.length === 0 ? /* @__PURE__ */ jsx(View, { padding: "size-400", children: /* @__PURE__ */ jsx(Text, { UNSAFE_style: { color: PALETTE.textMuted }, children: "No audit entries match these filters." }) }) : items.map((row, i) => {
            const isEncrypted = row.oldValue === SENSITIVE_TOKEN || row.newValue === SENSITIVE_TOKEN;
            const cell = {
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              minWidth: 0
            };
            return /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  display: "grid",
                  // Min/max so columns flex but never collapse below readable.
                  gridTemplateColumns: GRID,
                  padding: "12px 16px",
                  gap: 12,
                  borderBottom: `1px solid ${PALETTE.border}`,
                  fontSize: 13,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  background: i % 2 === 0 ? PALETTE.surface : PALETTE.surfaceSubtle,
                  alignItems: "start"
                },
                children: [
                  canRevert && /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(Checkbox, { "aria-label": "Select row", isSelected: selectedIds.has(rowId(row)), onChange: () => toggleSelect(rowId(row)), isDisabled: deleting }) }),
                  /* @__PURE__ */ jsx("div", { style: { ...cell, color: PALETTE.text }, children: fmtTime(row.changedAt) }),
                  /* @__PURE__ */ jsx("div", { style: { ...cell, color: PALETTE.textMuted }, children: row.changedBy || "system" }),
                  /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(StatusLight, { variant: actionTone(row.action), children: row.action || "?" }) }),
                  /* @__PURE__ */ jsxs("div", { style: cell, children: [
                    /* @__PURE__ */ jsx("div", { children: row.path }),
                    /* @__PURE__ */ jsxs("div", { style: { color: PALETTE.textMuted, fontSize: 11 }, children: [
                      row.scope,
                      ":",
                      row.scope_id
                    ] })
                  ] }),
                  /* @__PURE__ */ jsx("div", { style: { ...cell, color: PALETTE.danger }, children: fmtValue(row.oldValue) }),
                  /* @__PURE__ */ jsx("div", { style: { ...cell, color: PALETTE.success }, children: fmtValue(row.newValue) }),
                  /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsxs(Flex, { gap: "size-100", wrap: true, children: [
                    /* @__PURE__ */ jsx(
                      Button,
                      {
                        variant: "secondary",
                        onPress: () => startRevert(row),
                        isDisabled: reverting || isEncrypted || !canRevert,
                        UNSAFE_style: { fontFamily: "inherit" },
                        children: isEncrypted ? "N/A" : !canRevert ? "Admin only" : "Revert"
                      }
                    ),
                    canRevert && /* @__PURE__ */ jsx(
                      Button,
                      {
                        variant: "negative",
                        isQuiet: true,
                        onPress: () => setConfirmDelete({ ids: [rowId(row)] }),
                        isDisabled: deleting,
                        UNSAFE_style: { fontFamily: "inherit" },
                        children: "Delete"
                      }
                    )
                  ] }) })
                ]
              },
              row._id || `${row.changedAt}-${row.path}-${i}`
            );
          })
        ]
      }
    ),
    /* @__PURE__ */ jsxs(DialogTrigger, { isOpen: !!confirmDelete, onOpenChange: (o) => {
      if (!o) setConfirmDelete(null);
    }, children: [
      /* @__PURE__ */ jsx("div", { style: { display: "none" }, "aria-hidden": "true", children: "trigger" }),
      /* @__PURE__ */ jsxs(Dialog, { children: [
        /* @__PURE__ */ jsxs(Heading, { children: [
          "Delete audit ",
          confirmDelete && confirmDelete.ids.length === 1 ? "entry" : "entries",
          "?"
        ] }),
        /* @__PURE__ */ jsx(Divider, {}),
        /* @__PURE__ */ jsx(Content, { children: /* @__PURE__ */ jsxs(Text, { children: [
          "Permanently delete ",
          /* @__PURE__ */ jsx("strong", { children: confirmDelete ? confirmDelete.ids.length : 0 }),
          " audit",
          confirmDelete && confirmDelete.ids.length === 1 ? " entry" : " entries",
          "? This can't be undone."
        ] }) }),
        /* @__PURE__ */ jsxs(ButtonGroup, { children: [
          /* @__PURE__ */ jsx(Button, { variant: "secondary", onPress: () => setConfirmDelete(null), isDisabled: deleting, children: "Cancel" }),
          /* @__PURE__ */ jsx(Button, { variant: "negative", onPress: () => runDelete(confirmDelete.ids), isDisabled: deleting, children: deleting ? "Deleting\u2026" : "Delete" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs(DialogTrigger, { isOpen: !!confirmRow, onOpenChange: (o) => {
      if (!o) setConfirmRow(null);
    }, children: [
      /* @__PURE__ */ jsx("div", { style: { display: "none" }, "aria-hidden": "true", children: "trigger" }),
      /* @__PURE__ */ jsxs(Dialog, { children: [
        /* @__PURE__ */ jsx(Heading, { children: "Revert this change?" }),
        /* @__PURE__ */ jsx(Header, { children: /* @__PURE__ */ jsxs(Text, { children: [
          confirmRow == null ? void 0 : confirmRow.path,
          " at ",
          confirmRow == null ? void 0 : confirmRow.scope,
          ":",
          confirmRow == null ? void 0 : confirmRow.scope_id
        ] }) }),
        /* @__PURE__ */ jsx(Divider, {}),
        /* @__PURE__ */ jsxs(Content, { children: [
          /* @__PURE__ */ jsx(Text, { children: (confirmRow == null ? void 0 : confirmRow.action) === "create" ? /* @__PURE__ */ jsxs(Fragment, { children: [
            "This will ",
            /* @__PURE__ */ jsx("strong", { children: "delete" }),
            " the scope-level override and fall back to the inherited default."
          ] }) : (confirmRow == null ? void 0 : confirmRow.action) === "delete" ? /* @__PURE__ */ jsxs(Fragment, { children: [
            "This will ",
            /* @__PURE__ */ jsx("strong", { children: "re-insert" }),
            " the previous value."
          ] }) : /* @__PURE__ */ jsx(Fragment, { children: "This will replace the current value with the previous value." }) }),
          /* @__PURE__ */ jsxs("div", { style: {
            marginTop: 12,
            padding: 12,
            background: PALETTE.surfaceMuted,
            border: `1px solid ${PALETTE.border}`,
            borderRadius: RADIUS.md,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            wordBreak: "break-all"
          }, children: [
            /* @__PURE__ */ jsx("div", { style: { color: PALETTE.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }, children: "will be set to" }),
            /* @__PURE__ */ jsx("div", { style: { color: PALETTE.success }, children: (confirmRow == null ? void 0 : confirmRow.action) === "create" ? "(inherit from default)" : fmtValue(confirmRow == null ? void 0 : confirmRow.oldValue) })
          ] })
        ] }),
        /* @__PURE__ */ jsxs(ButtonGroup, { children: [
          /* @__PURE__ */ jsx(Button, { variant: "secondary", onPress: () => setConfirmRow(null), isDisabled: reverting, children: "Cancel" }),
          /* @__PURE__ */ jsx(Button, { variant: "cta", onPress: () => doRevert(confirmRow), isDisabled: reverting, children: reverting ? "Reverting\u2026" : "Revert" })
        ] })
      ] })
    ] })
  ] });
}

// web/src/index.js
function registerAuditLog() {
  configureWeb({
    actionKeys: {
      systemConfigAuditList: "AuditLog/system-config-audit-list",
      systemConfigAuditDelete: "AuditLog/system-config-audit-delete"
    },
    extraNav: [{
      id: "audit-log",
      path: "/audit-log",
      label: "Audit Log",
      icon: "Properties",
      parentId: "system"
    }],
    extraPages: { "audit-log": AuditLog }
  });
}
export {
  AuditLog,
  registerAuditLog as default
};
