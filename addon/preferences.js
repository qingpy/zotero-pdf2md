/* global Zotero, Components, window, document */
"use strict";

var ZoteroPDF2MD_Preferences = {
	async chooseExportFolder() {
		try {
			const nsIFilePicker = Components.interfaces.nsIFilePicker;
			const fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
			if (Zotero.platformMajorVersion >= 120) {
				fp.init(window.browsingContext, "Choose Export Folder", nsIFilePicker.modeGetFolder);
			} else {
				fp.init(window, "Choose Export Folder", nsIFilePicker.modeGetFolder);
			}
			const current = Zotero.Prefs.get("extensions.zotero-pdf2md.exportDir", true);
			if (current) {
				try {
					fp.displayDirectory = Zotero.File.pathToFile(current);
				} catch (e) {}
			}
			const rv = await new Promise((resolve) => fp.open(resolve));
			if (rv !== nsIFilePicker.returnOK) return;
			Zotero.Prefs.set("extensions.zotero-pdf2md.exportDir", fp.file.path, true);
			const input = document.getElementById("zotero-pdf2md-export-dir");
			if (input) input.value = fp.file.path;
		} catch (e) {
			Zotero.debug("PDF2MD prefs: " + (e.message || e) + "\n" + (e.stack || ""));
		}
	},

	wire() {
		const btn = document.getElementById("zotero-pdf2md-export-choose");
		if (!btn || btn.hasAttribute("data-pdf2md-wired")) return !!btn;
		btn.setAttribute("data-pdf2md-wired", "1");
		btn.addEventListener("command", () => this.chooseExportFolder());
		return true;
	},
};

// Wire now if the pane is already in the DOM, otherwise wait for it
// (inline oncommand= handlers are blocked by CSP in recent Zotero versions)
if (!ZoteroPDF2MD_Preferences.wire()) {
	const observer = new MutationObserver(() => {
		if (ZoteroPDF2MD_Preferences.wire()) observer.disconnect();
	});
	observer.observe(document.documentElement, { childList: true, subtree: true });
}
