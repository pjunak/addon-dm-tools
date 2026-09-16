import { messageBlock } from "./planner-fields.js";
export function recoveryPanel(document, t, options) {
    const panel = document.createElement("section");
    panel.dataset["plannerRecovery"] = "";
    panel.append(messageBlock(document, options.invalid
        ? t("This recovery copy cannot be opened. Download it before discarding it.")
        : options.pending
            ? t("Unsaved planner work is available in this tab. Resume it for review; nothing is saved automatically.")
            : options.unavailable
                ? t("The latest planner edits could not be kept in this tab. Download your drafts before leaving.")
                : t("Unsaved planner work is kept in this tab for recovery. Save to the campaign when ready."), options.invalid || options.unavailable ? "alert" : "status"));
    const actions = document.createElement("div");
    actions.dataset["uiActions"] = "";
    const button = (label, run) => {
        const control = document.createElement("button");
        control.type = "button";
        control.dataset["viewAction"] = "";
        control.textContent = label;
        control.addEventListener("click", run);
        return control;
    };
    if (options.pending && !options.invalid)
        actions.append(button(t("Resume drafts"), options.resume));
    actions.append(button(t("Download drafts"), options.download));
    if (options.pending)
        actions.append(button(t("Discard recovery copy"), options.discard));
    panel.append(actions);
    return panel;
}
export function downloadDrafts(document, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "planner-drafts.txt";
    try {
        document.body.append(link);
        link.click();
    }
    finally {
        link.remove();
        URL.revokeObjectURL(url);
    }
}
