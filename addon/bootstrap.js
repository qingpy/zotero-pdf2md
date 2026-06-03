/* global Zotero, Services */
"use strict";

var ZoteroPDF2MD;

function log(msg) {
	Zotero.debug("PDF2MD: " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	await Zotero.initializationPromise;
	log("Starting " + version);
	Services.scriptloader.loadSubScript(rootURI + "zotero-pdf2md.js");
	ZoteroPDF2MD.init({ id, version, rootURI });
	await ZoteroPDF2MD.registerPrefPane();
	ZoteroPDF2MD.addToAllWindows();
}

function onMainWindowLoad({ window }) {
	ZoteroPDF2MD.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	ZoteroPDF2MD.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	if (ZoteroPDF2MD) {
		ZoteroPDF2MD.shutdown();
		ZoteroPDF2MD.removeFromAllWindows();
		ZoteroPDF2MD = undefined;
	}
}

function uninstall() {
	log("Uninstalled");
}
