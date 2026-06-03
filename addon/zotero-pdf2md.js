/* global Zotero, Components, Services, IOUtils, PathUtils */
"use strict";

ZoteroPDF2MD = {
	id: null,
	version: null,
	rootURI: null,
	prefPaneID: null,
	_shutdown: false,
	_busy: false,
	_chain: Promise.resolve(),
	_notifierID: null,
	_autoQueue: new Set(),
	_autoScheduled: false,
	_status: null,

	API_BASE: "https://mineru.net/api/v4",
	AGENT_BASE: "https://mineru.net/api/v1/agent",
	PREF_BRANCH: "extensions.zotero-pdf2md.",
	HTML_NS: "http://www.w3.org/1999/xhtml",
	MENU_IDS: ["zotero-pdf2md-convert", "zotero-pdf2md-export", "zotero-pdf2md-export-to"],
	BATCH_LIMIT: 50, // max files per /file-urls/batch request
	POLL_INTERVAL: 5000, // ms
	POLL_TIMEOUT: 45 * 60 * 1000, // ms per batch
	LIGHT_POLL_INTERVAL: 4000, // ms
	LIGHT_POLL_TIMEOUT: 15 * 60 * 1000, // ms per file

	init({ id, version, rootURI }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this._shutdown = false;
		this._notifierID = Zotero.Notifier.registerObserver(
			this._observer, ["item"], "zotero-pdf2md"
		);
		// One-time migration from the pre-release "zotero-mineru" pref branch
		const OLD = "extensions.zotero-mineru.";
		if (!this.getPref("apiToken") && Zotero.Prefs.get(OLD + "apiToken", true)) {
			for (const k of ["apiToken", "modelVersion", "language", "isOcr",
				"enableFormula", "enableTable", "autoConvert",
				"exportDir", "exportPerItem", "exportLastType"]) {
				const v = Zotero.Prefs.get(OLD + k, true);
				if (v !== undefined) Zotero.Prefs.set(this.PREF_BRANCH + k, v, true);
			}
			this.log("Migrated settings from zotero-mineru");
		}
	},

	shutdown() {
		this._shutdown = true;
		if (this._notifierID) {
			Zotero.Notifier.unregisterObserver(this._notifierID);
			this._notifierID = null;
		}
	},

	log(msg) {
		Zotero.debug("PDF2MD: " + msg);
	},

	getPref(key) {
		return Zotero.Prefs.get(this.PREF_BRANCH + key, true);
	},

	async registerPrefPane() {
		this.prefPaneID = await Zotero.PreferencePanes.register({
			pluginID: this.id,
			src: this.rootURI + "preferences.xhtml",
			scripts: [this.rootURI + "preferences.js"],
			label: "PDF to Markdown",
			image: this.rootURI + "icon.svg",
		});
	},

	// ======================================================================
	// UI: menu items
	// ======================================================================

	addToAllWindows() {
		for (const win of Zotero.getMainWindows()) {
			this.addToWindow(win);
		}
	},

	addToWindow(window) {
		const doc = window.document;
		const itemmenu = doc.getElementById("zotero-itemmenu");
		if (!itemmenu || doc.getElementById(this.MENU_IDS[0])) return;
		const add = (id, label, fn) => {
			const mi = doc.createXULElement("menuitem");
			mi.id = id;
			mi.setAttribute("label", label);
			mi.addEventListener("command", () => {
				fn().catch((e) => {
					this.log("Error: " + (e.message || e) + "\n" + (e.stack || ""));
					window.alert("PDF2MD: " + (e.message || e));
				});
			});
			itemmenu.appendChild(mi);
		};
		add(this.MENU_IDS[0], "Convert to Markdown (MinerU)",
			() => this.convertSelectedItems(window));
		add(this.MENU_IDS[1], "Export Attachments",
			() => this.exportSelected(window, false));
		add(this.MENU_IDS[2], "Export Attachments To…",
			() => this.exportSelected(window, true));
	},

	removeFromAllWindows() {
		for (const win of Zotero.getMainWindows()) {
			this.removeFromWindow(win);
		}
	},

	removeFromWindow(window) {
		for (const id of this.MENU_IDS) {
			const el = window.document.getElementById(id);
			if (el) el.remove();
		}
		const status = window.document.getElementById("zotero-pdf2md-status");
		if (status) status.remove();
		for (const t of window.document.querySelectorAll(".zotero-pdf2md-toast")) {
			t.remove();
		}
		if (this._status && this._status.win === window) this._status = null;
	},

	// ======================================================================
	// UI: in-window status overlay (no separate OS window / taskbar entry)
	// ======================================================================

	_boxStyle: "position:fixed;right:14px;bottom:14px;z-index:99999;"
		+ "background:canvas;color:canvastext;"
		+ "border:1px solid color-mix(in srgb, canvastext 25%, transparent);"
		+ "border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);"
		+ "padding:9px 12px;font:menu;max-width:340px;cursor:default;user-select:none;",
	_rowStyle: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.5;",

	_statusShow(headline) {
		const win = Zotero.getMainWindow();
		if (!win) return;
		this._statusCancelTimer();
		let s = this._status;
		if (!s || !s.el.isConnected || s.win !== win) {
			if (s && s.el) s.el.remove();
			const doc = win.document;
			const el = doc.createElementNS(this.HTML_NS, "div");
			el.id = "zotero-pdf2md-status";
			el.style.cssText = this._boxStyle;
			const headWrap = doc.createElementNS(this.HTML_NS, "div");
			headWrap.style.cssText = "display:flex;align-items:center;gap:10px;";
			const head = doc.createElementNS(this.HTML_NS, "div");
			head.style.cssText = this._rowStyle + "font-weight:600;flex:1;";
			const close = doc.createElementNS(this.HTML_NS, "div");
			close.textContent = "✕";
			close.style.cssText = "cursor:pointer;opacity:.55;";
			close.addEventListener("click", () => { el.hidden = true; });
			headWrap.append(head, close);
			const list = doc.createElementNS(this.HTML_NS, "div");
			list.style.cssText = "max-height:40vh;overflow-y:auto;";
			const note = doc.createElementNS(this.HTML_NS, "div");
			note.style.cssText = this._rowStyle + "opacity:.65;";
			note.hidden = true;
			el.append(headWrap, list, note);
			doc.documentElement.appendChild(el);
			s = this._status = { win, el, head, list, note, rows: new Map(), timer: null };
		}
		s.rows.clear();
		s.list.replaceChildren();
		s.note.hidden = true;
		s.el.hidden = false;
		s.head.textContent = headline;
	},

	_statusHeadline(text) {
		const s = this._status;
		if (s && s.el.isConnected) s.head.textContent = text;
	},

	_statusLine(key, text, kind) {
		const s = this._status;
		if (!s || !s.el.isConnected) return;
		let row = s.rows.get(key);
		if (!row) {
			row = s.win.document.createElementNS(this.HTML_NS, "div");
			row.style.cssText = this._rowStyle;
			s.list.appendChild(row);
			s.rows.set(key, row);
		}
		row.textContent = text;
		row.style.color = kind === "error" ? "#e35d5d" : "";
		row.style.opacity = kind === "done" ? ".65" : "";
	},

	_statusNote(text) {
		const s = this._status;
		if (!s || !s.el.isConnected) return;
		s.note.textContent = text;
		s.note.hidden = false;
	},

	_statusClose(delay) {
		const s = this._status;
		if (!s) return;
		this._statusCancelTimer();
		s.timer = s.win.setTimeout(() => {
			s.el.remove();
			if (this._status === s) this._status = null;
		}, delay || 0);
	},

	_statusCancelTimer() {
		const s = this._status;
		if (s && s.timer) {
			s.win.clearTimeout(s.timer);
			s.timer = null;
		}
	},

	_toast(lines, duration = 4000) {
		const win = Zotero.getMainWindow();
		if (!win) return;
		const doc = win.document;
		const el = doc.createElementNS(this.HTML_NS, "div");
		el.className = "zotero-pdf2md-toast";
		el.style.cssText = this._boxStyle;
		const st = this._status;
		if (st && st.el.isConnected && !st.el.hidden) {
			el.style.bottom = (14 + st.el.getBoundingClientRect().height + 10) + "px";
		}
		lines.forEach((text, i) => {
			const d = doc.createElementNS(this.HTML_NS, "div");
			d.style.cssText = this._rowStyle + (i === 0 ? "font-weight:600;" : "");
			d.textContent = text;
			el.appendChild(d);
		});
		el.addEventListener("click", () => el.remove());
		doc.documentElement.appendChild(el);
		win.setTimeout(() => el.remove(), duration);
	},

	// ======================================================================
	// Auto-convert (newly added PDF attachments)
	// ======================================================================

	_observer: {
		notify(event, type, ids) {
			try {
				ZoteroPDF2MD._onNotify(event, type, ids);
			} catch (e) {
				ZoteroPDF2MD.log("Notifier error: " + (e.message || e));
			}
		},
	},

	_onNotify(event, type, ids) {
		if (event !== "add" || type !== "item") return;
		if (!this.getPref("autoConvert")) return;
		for (const id of ids) {
			const item = Zotero.Items.get(id);
			if (item && item.isAttachment()
					&& item.attachmentContentType === "application/pdf") {
				this._autoQueue.add(id);
			}
		}
		if (!this._autoQueue.size || this._autoScheduled) return;
		this._autoScheduled = true;
		(async () => {
			await Zotero.Promise.delay(15000); // let downloads settle
			this._autoScheduled = false;
			if (this._shutdown) return;
			const items = Zotero.Items.get([...this._autoQueue]).filter(Boolean);
			this._autoQueue.clear();
			// Wait (up to 60 s) for files still downloading
			for (const item of items) {
				let waited = 0;
				while (!(await item.getFilePathAsync()) && waited < 60000 && !this._shutdown) {
					await Zotero.Promise.delay(5000);
					waited += 5000;
				}
			}
			if (items.length && !this._shutdown) {
				this.log("Auto-converting " + items.length + " new PDF(s)");
				this.enqueueConvert(items, Zotero.getMainWindow(), { interactive: false });
			}
		})().catch((e) => {
			this._autoScheduled = false;
			this.log("Auto-convert error: " + (e.message || e));
		});
	},

	// ======================================================================
	// Conversion queue
	// ======================================================================

	async convertSelectedItems(window) {
		const items = window.ZoteroPane.getSelectedItems();
		if (!items.length) {
			window.alert("No items selected.");
			return;
		}
		this.enqueueConvert(items, window, { interactive: true });
	},

	enqueueConvert(items, window, opts) {
		if (this._busy) this._toast(["PDF2MD: queued"], 2000);
		this._chain = this._chain
			.then(() => this._runConversion(items, window, opts))
			.catch((e) => this.log("Run error: " + (e.message || e)));
		return this._chain;
	},

	// ======================================================================
	// Conversion pipeline
	// ======================================================================

	async _runConversion(items, window, { interactive }) {
		if (this._shutdown) return;

		let token = String(this.getPref("apiToken") || "").trim();
		token = token.replace(/^Bearer\s+/i, "");
		const light = !token; // no token → MinerU's lightweight Agent API

		const { jobs, skipped } = await this._collectJobs(items);
		if (skipped.length) this.log("Skipped:\n  " + skipped.join("\n  "));
		if (!jobs.length) {
			if (interactive) this._toast(["PDF2MD: nothing to convert", "see debug log"], 4000);
			return;
		}

		this._busy = true;
		try {
			this._statusShow("PDF2MD 0/" + jobs.length);
			for (const job of jobs) {
				this._statusLine(job.dataId, "• " + this._short(job.pdfName));
			}
			const notes = [];
			if (light) notes.push("light API, no token (≤20 pages)");
			if (skipped.length) notes.push(skipped.length + " skipped");
			if (notes.length) this._statusNote(notes.join(" · "));

			let done = 0;
			const onFinish = () => {
				done++;
				this._statusHeadline("PDF2MD " + done + "/" + jobs.length);
			};
			if (light) {
				for (const job of jobs) {
					if (this._shutdown) break;
					await this._processLight(job);
					onFinish();
				}
			} else {
				for (let i = 0; i < jobs.length; i += this.BATCH_LIMIT) {
					await this._processBatch(jobs.slice(i, i + this.BATCH_LIMIT), token, onFinish);
				}
			}

			const ok = jobs.filter((j) => j.saved).length;
			const failed = jobs.length - ok;
			this.log(ok + " converted, " + failed + " failed");
			this._statusHeadline("PDF2MD: " + ok + " done" + (failed ? ", " + failed + " failed" : ""));
		} catch (e) {
			this.log("Conversion error: " + (e.message || e) + "\n" + (e.stack || ""));
			this._statusHeadline("PDF2MD error");
			this._statusNote(this._short(String(e.message || e), 60));
		} finally {
			this._busy = false;
			this._statusClose(8000);
		}
	},

	async _collectJobs(items) {
		const jobs = [];
		const seen = new Set();
		const skipped = [];
		for (const item of items) {
			try {
				let att = null;
				if (item.isAttachment()) {
					att = item;
				} else if (item.isRegularItem()) {
					att = (await item.getBestAttachment()) || null;
					if (!att || att.attachmentContentType !== "application/pdf") {
						att = null;
						for (const id of item.getAttachments()) {
							const a = Zotero.Items.get(id);
							if (a && a.attachmentContentType === "application/pdf") {
								att = a;
								break;
							}
						}
					}
				} else {
					skipped.push(this._label(item) + ": not convertible");
					continue;
				}
				if (!att || att.attachmentContentType !== "application/pdf") {
					skipped.push(this._label(item) + ": no PDF");
					continue;
				}
				if (seen.has(att.id)) continue;
				seen.add(att.id);

				const path = await att.getFilePathAsync();
				if (!path) {
					skipped.push(this._label(item) + ": PDF not on disk");
					continue;
				}
				const pdfName = PathUtils.filename(path);
				const mdName = pdfName.replace(/\.pdf$/i, "") + ".md";
				const parent = att.parentItem || null;
				if (parent && this._hasMarkdownAttachment(parent, mdName)) {
					skipped.push(this._label(item) + ": .md already exists");
					continue;
				}
				jobs.push({
					att, parent, path, pdfName, mdName,
					dataId: "L" + att.libraryID + "-" + att.key,
					finished: false,
					saved: false,
					errMsg: "",
				});
			} catch (e) {
				skipped.push(this._label(item) + ": " + (e.message || e));
			}
		}
		return { jobs, skipped };
	},

	_hasMarkdownAttachment(parent, mdName) {
		for (const id of parent.getAttachments()) {
			const a = Zotero.Items.get(id);
			if (!a || !a.isAttachment()) continue;
			try {
				if (a.attachmentFilename === mdName || a.getField("title") === mdName) {
					return true;
				}
			} catch (e) {}
		}
		return false;
	},

	_label(item) {
		try {
			return item.getDisplayTitle();
		} catch (e) {
			return "item " + item.id;
		}
	},

	// --- Precision API (token): batch upload + poll ---

	async _processBatch(jobs, token, onFinish) {
		// 1. Request signed upload URLs
		const body = {
			files: jobs.map((j) => ({
				name: j.dataId + ".pdf",
				data_id: j.dataId,
				is_ocr: !!this.getPref("isOcr"),
			})),
			model_version: String(this.getPref("modelVersion") || "vlm"),
			language: String(this.getPref("language") || "ch").trim() || "ch",
			enable_formula: !!this.getPref("enableFormula"),
			enable_table: !!this.getPref("enableTable"),
		};
		const data = await this._api("POST", this.API_BASE + "/file-urls/batch", body, token);
		const batchId = data.batch_id;
		const urls = data.file_urls || [];
		if (urls.length !== jobs.length) {
			throw new Error("got " + urls.length + " upload URLs for " + jobs.length + " files");
		}
		this.log("Batch " + batchId + ": " + jobs.length + " file(s)");

		// 2. Upload the PDFs (PUT, no auth / no Content-Type per MinerU docs)
		for (let i = 0; i < jobs.length; i++) {
			const job = jobs[i];
			this._setLine(job, "uploading");
			const bytes = await IOUtils.read(job.path);
			const resp = await this._fetch(urls[i], { method: "PUT", body: bytes });
			if (!resp.ok) {
				throw new Error("upload failed (HTTP " + resp.status + ")");
			}
			this._setLine(job, "queued");
		}

		// 3. Poll; save each result as it completes
		const byDataId = new Map(jobs.map((j) => [j.dataId, j]));
		const start = Date.now();
		while (!this._shutdown) {
			if (Date.now() - start > this.POLL_TIMEOUT) {
				throw new Error("timed out (batch " + batchId + ")");
			}
			await Zotero.Promise.delay(this.POLL_INTERVAL);
			let result;
			try {
				result = await this._api("GET", this.API_BASE + "/extract-results/batch/" + batchId, null, token);
			} catch (e) {
				this.log("Poll error (retrying): " + (e.message || e));
				continue;
			}
			for (const r of result.extract_result || []) {
				const job = byDataId.get(r.data_id);
				if (!job || job.finished) continue;
				if (r.state === "failed") {
					job.finished = true;
					job.errMsg = r.err_msg || "extraction failed";
					this._setLine(job, this._short(job.errMsg, 40), "error");
					this.log(job.pdfName + " failed: " + job.errMsg);
					onFinish();
				} else if (r.state === "done") {
					job.finished = true;
					this._setLine(job, "saving");
					try {
						await this._saveZipResult(job, r.full_zip_url);
						job.saved = true;
						this._setLine(job, "done", "done");
					} catch (e) {
						job.errMsg = e.message || String(e);
						this._setLine(job, this._short(job.errMsg, 40), "error");
						this.log("Saving " + job.pdfName + " failed: " + job.errMsg + "\n" + (e.stack || ""));
					}
					onFinish();
				} else {
					this._setLine(job, this._stateText(r));
				}
			}
			if (!jobs.some((j) => !j.finished)) break;
		}
		if (this._shutdown) throw new Error("shut down during conversion");
	},

	// --- Agent light API (no token): one file at a time ---

	async _processLight(job) {
		try {
			this._setLine(job, "uploading");
			const data = await this._api("POST", this.AGENT_BASE + "/parse/file", {
				file_name: job.dataId + ".pdf",
				language: String(this.getPref("language") || "ch").trim() || "ch",
				is_ocr: !!this.getPref("isOcr"),
				enable_formula: !!this.getPref("enableFormula"),
				enable_table: !!this.getPref("enableTable"),
			}, null);
			const bytes = await IOUtils.read(job.path);
			const up = await this._fetch(data.file_url, { method: "PUT", body: bytes });
			if (!up.ok) throw new Error("upload failed (HTTP " + up.status + ")");

			const start = Date.now();
			while (!this._shutdown) {
				if (Date.now() - start > this.LIGHT_POLL_TIMEOUT) {
					throw new Error("timed out");
				}
				await Zotero.Promise.delay(this.LIGHT_POLL_INTERVAL);
				let r;
				try {
					r = await this._api("GET", this.AGENT_BASE + "/parse/" + data.task_id, null, null);
				} catch (e) {
					this.log("Poll error (retrying): " + (e.message || e));
					continue;
				}
				if (r.state === "done") {
					this._setLine(job, "saving");
					await this._saveLightResult(job, r.markdown_url);
					job.saved = true;
					this._setLine(job, "done", "done");
					return;
				}
				if (r.state === "failed") {
					throw new Error(r.err_msg || "extraction failed");
				}
				this._setLine(job, r.state === "running" ? "extracting" : "queued");
			}
			throw new Error("shut down during conversion");
		} catch (e) {
			job.errMsg = e.message || String(e);
			this._setLine(job, this._short(job.errMsg, 40), "error");
			this.log(job.pdfName + " failed: " + job.errMsg);
		} finally {
			job.finished = true;
		}
	},

	_stateText(r) {
		if (r.state === "running") {
			const p = r.extract_progress;
			if (p && p.total_pages) return p.extracted_pages + "/" + p.total_pages + " pages";
			return "extracting";
		}
		if (r.state === "converting") return "converting";
		return "queued";
	},

	_setLine(job, status, kind) {
		const sym = kind === "done" ? "✓" : kind === "error" ? "✗" : "→";
		this._statusLine(job.dataId,
			sym + " " + this._short(job.pdfName) + " · " + status, kind);
	},

	_short(name, max = 32) {
		name = String(name);
		if (name.length <= max) return name;
		return name.slice(0, max - 10) + "…" + name.slice(-9);
	},

	// --- Saving results ---

	_jobTmpDir(job) {
		return PathUtils.join(Zotero.getTempDirectory().path,
			"zotero-pdf2md", job.dataId + "-" + Date.now());
	},

	async _saveZipResult(job, zipUrl) {
		if (!zipUrl) throw new Error("no result zip URL");
		const tmpDir = this._jobTmpDir(job);
		await IOUtils.makeDirectory(tmpDir, { createAncestors: true, ignoreExisting: true });
		const zipPath = PathUtils.join(tmpDir, "result.zip");
		const mdPath = PathUtils.join(tmpDir, job.mdName);

		const resp = await this._fetch(zipUrl, { method: "GET" });
		if (!resp.ok) throw new Error("result download failed (HTTP " + resp.status + ")");
		await IOUtils.write(zipPath, new Uint8Array(await resp.arrayBuffer()));

		// Extract full.md
		const zr = Components.classes["@mozilla.org/libjar/zip-reader;1"]
			.createInstance(Components.interfaces.nsIZipReader);
		zr.open(Zotero.File.pathToFile(zipPath));
		try {
			let mdEntry = null;
			const entries = zr.findEntries("*");
			while (entries.hasMore()) {
				const entry = entries.getNext();
				if (entry === "full.md" || entry.endsWith("/full.md")) {
					mdEntry = entry;
					break;
				}
			}
			if (!mdEntry) throw new Error("full.md not in result zip");
			zr.extract(mdEntry, Zotero.File.pathToFile(mdPath));
		} finally {
			zr.close();
		}

		await this._importMarkdown(job, mdPath, tmpDir);
	},

	async _saveLightResult(job, markdownUrl) {
		if (!markdownUrl) throw new Error("no markdown URL");
		const tmpDir = this._jobTmpDir(job);
		await IOUtils.makeDirectory(tmpDir, { createAncestors: true, ignoreExisting: true });
		const mdPath = PathUtils.join(tmpDir, job.mdName);

		const resp = await this._fetch(markdownUrl, { method: "GET" });
		if (!resp.ok) throw new Error("result download failed (HTTP " + resp.status + ")");
		await IOUtils.writeUTF8(mdPath, await resp.text());

		await this._importMarkdown(job, mdPath, tmpDir);
	},

	// Import as child attachment (or top-level if the PDF has no parent)
	async _importMarkdown(job, mdPath, tmpDir) {
		const options = {
			file: mdPath,
			contentType: "text/markdown",
			charset: "utf-8",
			title: job.mdName,
		};
		if (job.parent) {
			options.parentItemID = job.parent.id;
		} else {
			options.libraryID = job.att.libraryID;
			const cols = job.att.getCollections();
			if (cols.length) options.collections = cols;
		}
		await Zotero.Attachments.importFromFile(options);

		// Cleanup is best-effort (Zotero clears its temp dir on exit)
		try {
			await IOUtils.remove(tmpDir, { recursive: true, ignoreAbsent: true });
		} catch (e) {
			this.log("Temp cleanup deferred: " + (e.message || e));
		}
	},

	// ======================================================================
	// Attachment export
	// ======================================================================

	async exportSelected(window, alwaysAsk) {
		const items = window.ZoteroPane.getSelectedItems();
		if (!items.length) {
			window.alert("No items selected.");
			return;
		}

		const atts = [];
		const seen = new Set();
		const push = (a) => {
			if (a && a.isAttachment() && !seen.has(a.id)) {
				seen.add(a.id);
				atts.push(a);
			}
		};
		for (const item of items) {
			if (item.isAttachment()) push(item);
			else if (item.isRegularItem()) {
				for (const id of item.getAttachments()) push(Zotero.Items.get(id));
			}
		}

		const files = [];
		let missing = 0;
		for (const att of atts) {
			try {
				const path = await att.getFilePathAsync();
				if (path) files.push({ att, path });
				else missing++;
			} catch (e) {
				missing++;
			}
		}
		if (!files.length) {
			window.alert("No attachment files on disk.");
			return;
		}

		// Pick which file type to export (when more than one type is present)
		const byType = new Map();
		for (const f of files) {
			const n = PathUtils.filename(f.path);
			const dot = n.lastIndexOf(".");
			f.type = dot > 0 ? n.slice(dot + 1).toLowerCase() : "other";
			byType.set(f.type, (byType.get(f.type) || 0) + 1);
		}
		let chosen = files;
		if (byType.size > 1) {
			const types = [...byType.entries()].sort((a, b) => b[1] - a[1]);
			// Last-used type listed first, so Enter repeats it
			const last = String(this.getPref("exportLastType") || "");
			const list = [];
			const mapping = []; // "" = all types
			if (last && byType.has(last)) {
				list.push(last + " (" + byType.get(last) + ")");
				mapping.push(last);
			}
			list.push("All (" + files.length + ")");
			mapping.push("");
			for (const [t, c] of types) {
				if (t === last) continue;
				list.push(t + " (" + c + ")");
				mapping.push(t);
			}
			const sel = { value: 0 };
			if (!Services.prompt.select(window, "Export Attachments",
					"File type:", list, sel)) {
				return;
			}
			const pick = mapping[sel.value];
			Zotero.Prefs.set(this.PREF_BRANCH + "exportLastType", pick, true);
			if (pick) chosen = files.filter((f) => f.type === pick);
		}

		let dir = String(this.getPref("exportDir") || "").trim();
		let needAsk = alwaysAsk || !dir;
		if (!needAsk && !(await IOUtils.exists(dir))) needAsk = true;
		if (needAsk) {
			dir = await this._pickFolder(window, dir);
			if (!dir) return;
		}

		const perItem = !!this.getPref("exportPerItem");
		let copied = 0;
		const errors = [];
		for (const { att, path } of chosen) {
			try {
				let destDir = dir;
				if (perItem) {
					const parent = att.parentItem;
					destDir = PathUtils.join(dir,
						this._sanitize(parent ? parent.getDisplayTitle() : "No parent"));
					await IOUtils.makeDirectory(destDir, { ignoreExisting: true, createAncestors: true });
				}
				const dest = await this._uniquePath(PathUtils.join(destDir, PathUtils.filename(path)));
				await IOUtils.copy(path, dest);
				copied++;
			} catch (e) {
				errors.push(PathUtils.filename(path) + ": " + (e.message || e));
			}
		}

		const lines = ["Exported " + copied + " file" + (copied === 1 ? "" : "s"), dir];
		if (missing) lines.push(missing + " not on disk");
		if (errors.length) {
			lines.push(errors.length + " failed — see debug log");
			this.log("Export errors:\n  " + errors.join("\n  "));
		}
		this._toast(lines, 5000);
		try {
			await Zotero.File.reveal(dir);
		} catch (e) {}
	},

	async _pickFolder(window, startDir) {
		const nsIFilePicker = Components.interfaces.nsIFilePicker;
		const fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
		// fp.init() takes a BrowsingContext on Firefox 120+, a window before
		if (Zotero.platformMajorVersion >= 120) {
			fp.init(window.browsingContext, "Choose folder", nsIFilePicker.modeGetFolder);
		} else {
			fp.init(window, "Choose folder", nsIFilePicker.modeGetFolder);
		}
		if (startDir) {
			try {
				fp.displayDirectory = Zotero.File.pathToFile(startDir);
			} catch (e) {}
		}
		const rv = await new Promise((resolve) => fp.open(resolve));
		if (rv !== nsIFilePicker.returnOK) return null;
		return fp.file.path;
	},

	async _uniquePath(dest) {
		if (!(await IOUtils.exists(dest))) return dest;
		const dir = PathUtils.parent(dest);
		const name = PathUtils.filename(dest);
		const dot = name.lastIndexOf(".");
		const base = dot > 0 ? name.slice(0, dot) : name;
		const ext = dot > 0 ? name.slice(dot) : "";
		for (let i = 2; i < 1000; i++) {
			const cand = PathUtils.join(dir, base + " (" + i + ")" + ext);
			if (!(await IOUtils.exists(cand))) return cand;
		}
		throw new Error("no unique name for " + dest);
	},

	_sanitize(name) {
		let out;
		try {
			out = Zotero.File.getValidFileName(name);
		} catch (e) {
			out = String(name).replace(/[\\/:*?"<>|]/g, "_");
		}
		out = out.trim().slice(0, 100).trim();
		return out || "Untitled";
	},

	// ======================================================================
	// HTTP
	// ======================================================================

	async _api(method, url, body, token) {
		const opts = {
			method,
			headers: { Accept: "*/*" },
		};
		if (token) opts.headers.Authorization = "Bearer " + token;
		if (body) {
			opts.headers["Content-Type"] = "application/json";
			opts.body = JSON.stringify(body);
		}
		const resp = await this._fetch(url, opts);
		let json = null;
		try {
			json = await resp.json();
		} catch (e) {}
		if (!resp.ok) {
			throw new Error("MinerU HTTP " + resp.status + (json && json.msg ? ": " + json.msg : ""));
		}
		if (!json || json.code !== 0) {
			throw new Error("MinerU error " + (json ? json.code + ": " + json.msg : "(bad response)"));
		}
		return json.data;
	},

	_fetch(url, opts) {
		const win = Zotero.getMainWindow();
		if (!win) throw new Error("no Zotero window for network requests");
		return win.fetch(url, opts);
	},
};
