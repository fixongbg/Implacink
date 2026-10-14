#target aftereffects
#targetengine "AOVShuttleEngine05"
/* BISI 0.6.3 - Batch Image Sequence Importer. Too busy? Get BISI! */
(function (host) {
    // Retain the preference namespace so existing settings survive the rename.
    var TITLE = "BISI", PANEL_TITLE = "BISI - Batch Image Sequence Importer", SECTION = "AOVShuttle02";
    var IMAGES = "exr,dpx,cin,tif,tiff,png,jpg,jpeg,tga,bmp,psd,sgi,rgb,rla,rpf,hdr".split(",");
    var DEFAULTS = "exr,png,jpg,jpeg,tif,tiff,tga,hdr";
    var state = { root: null, assets: [], targets: [], candidates: [], review: null, reviewProject: null, scanning: false, scanReady: false };
    var SCRIPT_DIR = new File($.fileName).parent;
    function resourceFile(name) {
        var besideScript = new File(SCRIPT_DIR.fsName + "/" + name);
        if (besideScript.exists) { return besideScript; }
        return new File(Folder.myDocuments.fsName + "/Codex/AOVShuttleSupport/" + name);
    }
    function trim(s) { return String(s === undefined || s === null ? "" : s).replace(/^\s+|\s+$/g, ""); }
    function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function has(a, x) { for (var i = 0; i < a.length; i++) { if (a[i] === x) { return true; } } return false; }
    function path(s) { return String(s).replace(/\\/g, "/").replace(/\/+$/, ""); }
    function pathKey(s) { return File.fs === "Windows" ? path(s).toLowerCase() : path(s); }
    function decode(s) { try { return File.decode(s); } catch (e) { return String(s); } }
    function terms(s) { var a = String(s).split(/[,;]+/), out = []; for (var i = 0; i < a.length; i++) { if (trim(a[i])) { out.push(trim(a[i])); } } return out; }
    function exts(s) { var a = terms(s); for (var i = 0; i < a.length; i++) { a[i] = a[i].toLowerCase().replace(/^\./, ""); } return a; }
    function ext(s) { var m = String(s).match(/\.([^.]+)$/); return m ? m[1].toLowerCase() : ""; }
    function num(s, label, min, max, integer) {
        var t = trim(s).replace(",", "."), n = Number(t);
        if (!t || !isFinite(n) || n < min || n > max || (integer && Math.floor(n) !== n)) { throw new Error(label + " must be " + (integer ? "an integer" : "a number") + " from " + min + " to " + max + "."); }
        return n;
    }
    function pref(k, fallback) { try { return app.settings.haveSetting(SECTION, k) ? app.settings.getSetting(SECTION, k) : fallback; } catch (e) { return fallback; } }
    function save(k, v) { try { app.settings.saveSetting(SECTION, k, String(v)); } catch (e) {} }
    function chooseRenderRoot(initial) {
        var start = initial ? new Folder(initial) : null;
        var chosen = Folder.selectDialog("Choose render folder", start && start.exists ? start : undefined);
        if (!chosen) { return null; }
        if (!chosen.exists) { throw new Error("Selected folder is no longer available: " + chosen.fsName); }
        return chosen;
    }
    var ACES_CONFIG = "ACES 1.3 CG v1.0", ACES_WORKING = "ACES/ACEScg", ACES_DISPLAY = "sRGB - Display/ACES 1.0 - SDR Video";
    function projectColorSnapshot(project) {
        var keys = ["colorManagementSystem", "ocioConfigurationFile", "workingSpace", "bitsPerChannel", "lutInterpolationMethod", "workingGamma", "linearizeWorkingSpace", "linearBlending", "compensateForSceneReferredProfiles"], out = {};
        for (var i = 0; i < keys.length; i++) { if (typeof project[keys[i]] !== "undefined") { out[keys[i]] = project[keys[i]]; } }
        return out;
    }
    function restoreProjectColor(project, saved) {
        // Engine/config first, because they define the valid working-space names.
        var keys = ["colorManagementSystem", "ocioConfigurationFile", "workingSpace", "bitsPerChannel", "lutInterpolationMethod", "workingGamma", "linearizeWorkingSpace", "linearBlending", "compensateForSceneReferredProfiles"], failures = [];
        for (var i = 0; i < keys.length; i++) { if (own(saved, keys[i]) && project[keys[i]] !== saved[keys[i]]) {
            if (keys[i] === "workingSpace" && saved.colorManagementSystem === 1 && /^ACES\//.test(saved.workingSpace)) { failures.push("OCIO working space requires native Project Settings > Color"); continue; }
            try { project[keys[i]] = saved[keys[i]]; if (project[keys[i]] !== saved[keys[i]]) { failures.push(keys[i] + " did not restore"); } } catch (e) { failures.push(keys[i] + ": " + e.toString()); }
        } }
        return failures;
    }
    function applyProjectPreset(preset) {
        if (preset !== "srgb" && preset !== "aces") { throw new Error("Unknown project color preset."); }
        if (!app.project) { app.newProject(); }
        var project = app.project;
        if (typeof project.colorManagementSystem !== "number") { throw new Error("This AE version does not expose the project color-engine API. Set the project Color settings manually."); }
        if (preset === "aces" && (typeof project.ocioConfigurationFile !== "string" || typeof project.lutInterpolationMethod !== "number")) { throw new Error("This AE version does not expose the required OCIO configuration/LUT APIs."); }
        var saved = projectColorSnapshot(project);
        app.beginUndoGroup(TITLE + " - " + (preset === "aces" ? "ACES project color" : "sRGB project color"));
        try {
            // Reassigning an unchanged OCIO engine/config resets AE's display
            // selector. Do not erase the verified profile loaded from the copy.
            if (project.colorManagementSystem !== (preset === "aces" ? 1 : 0)) { project.colorManagementSystem = preset === "aces" ? 1 : 0; }
            if (preset === "aces" && project.ocioConfigurationFile !== ACES_CONFIG) { project.ocioConfigurationFile = ACES_CONFIG; }
            // AE 26.5's workingSpace setter resolves ICC descriptions even in OCIO
            // mode. Writing ACES/ACEScg or ACEScg resets it to None. Preserve the
            // existing OCIO working choice and finish/check it in the native dialog.
            if (preset === "srgb") { project.workingSpace = "sRGB IEC61966-2.1"; }
            if (project.bitsPerChannel !== 32) { project.bitsPerChannel = 32; }
            if (preset === "aces" && project.lutInterpolationMethod !== 1) { project.lutInterpolationMethod = 1; }
            if (project.linearizeWorkingSpace !== false) { project.linearizeWorkingSpace = false; }
            if (project.linearBlending !== false) { project.linearBlending = false; }
            if (project.compensateForSceneReferredProfiles !== true) { project.compensateForSceneReferredProfiles = true; }
            if (preset === "srgb") { project.workingGamma = 2.2; }
            if (project.colorManagementSystem !== (preset === "aces" ? 1 : 0) || (preset === "srgb" && project.workingSpace !== "sRGB IEC61966-2.1") || project.bitsPerChannel !== 32 ||
                (preset === "aces" && (project.ocioConfigurationFile !== ACES_CONFIG || project.lutInterpolationMethod !== 1))) { throw new Error("AE did not retain the requested preset values."); }
        } catch (e) {
            var rollback = restoreProjectColor(project, saved);
            throw new Error("Project preset failed: " + e.toString() + (rollback.length ? "\nSome settings could not be restored: " + rollback.join("; ") : "\nPrevious project settings restored."));
        } finally { app.endUndoGroup(); }
        // No source interpretation or output-module properties are touched.
        // OCIO working/display completion is explicit, not a fake scripted field.
        return { preset: preset, workingCheckNeeded: preset === "aces" && project.workingSpace !== ACES_WORKING,
            workingTarget: preset === "aces" ? ACES_WORKING : "sRGB IEC61966-2.1", displayCheckNeeded: preset === "aces", displayTarget: preset === "aces" ? ACES_DISPLAY : "" };
    }
    function projectColorDescription() {
        if (!app.project) { return "No project open"; }
        var p = app.project, engine = p.colorManagementSystem === 1 ? "OCIO: " + p.ocioConfigurationFile : "Adobe";
        return engine + " | " + (p.workingSpace || "No working space") + " | " + p.bitsPerChannel + " bpc";
    }
    function openProjectSettings() {
        var id = app.findMenuCommandId("Project Settings...") || app.findMenuCommandId("Project Settings\u2026");
        if (!id) { throw new Error("Open File > Project Settings > Color to finish/check the display transform."); }
        app.executeCommand(id);
    }
    function relative(dir, root) {
        var d = path(dir), r = path(root);
        if (pathKey(d) === pathKey(r)) { return ""; }
        if (pathKey(d).indexOf(pathKey(r) + "/") !== 0) { throw new Error("Folder is outside scan root: " + dir); }
        return d.substring(r.length + 1);
    }
    function parts(name) {
        var whole = String(name), dot = whole.lastIndexOf("."), stem = whole.substring(0, dot), re = /\d+/g, m, chosen = null;
        if (dot < 0) { return null; }
        var frameStem = stem.replace(/(^|[^a-z0-9])(?:19|20)\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])(?=$|[^a-z0-9])/ig, function (date) { var spaces = ""; for (var i = 0; i < date.length; i++) { spaces += " "; } return spaces; });
        while ((m = re.exec(frameStem)) !== null) {
            // Version digits can follow the frame token (beauty_1001_v002.exr).
            if (/(?:^|[^a-z0-9])(?:v|ver|version)[_. -]*$/i.test(stem.substring(0, m.index))) { continue; }
            if (/(?:^|[^a-z0-9])(?:cam|camera|shot|scene|sh|sc)$/i.test(stem.substring(0, m.index))) { continue; }
            if (/^(?:19|20)\d{6}$/.test(m[0])) { continue; }
            chosen = { prefix: stem.substring(0, m.index), text: m[0], frame: parseInt(m[0], 10), suffix: stem.substring(m.index + m[0].length), extension: whole.substring(dot + 1).toLowerCase() };
        }
        return chosen;
    }
    function folderMatch(name, words, sensitive) {
        for (var i = 0; i < words.length; i++) { if ((sensitive ? name : name.toLowerCase()).indexOf(sensitive ? words[i] : words[i].toLowerCase()) >= 0) { return true; } }
        return false;
    }
    function groupFiles(files, dir, root, opts, now) {
        var buckets = {}, extensionBuckets = {}, result = [], i, f, p, k, b;
        for (i = 0; i < files.length; i++) {
            f = files[i]; if (!has(opts.extensions, ext(f.name))) { continue; }
            p = has(IMAGES, ext(f.name)) ? parts(f.name) : null;
            // No padding in key: frame1 through frame100 stay together.
            k = "$" + (p ? p.prefix + "\u001f" + p.suffix + "\u001f" + p.extension : "FILE\u001f" + f.name);
            if (File.fs === "Windows") { k = k.toLowerCase(); }
            if (!own(buckets, k)) { buckets[k] = { parts: p, files: [] }; extensionBuckets["$" + ext(f.name)] = (extensionBuckets["$" + ext(f.name)] || 0) + 1; }
            buckets[k].files.push({ name: f.name, path: f.path, frame: p ? p.frame : null, width: p ? p.text.length : 0, modified: f.modified });
        }
        for (k in buckets) {
            if (!own(buckets, k)) { continue; } b = buckets[k];
            b.files.sort(function (a, z) { return a.frame === z.frame ? (a.name < z.name ? -1 : 1) : a.frame - z.frame; });
            var latest = null, frames = [], duplicate = false, minWidth = 1000, maxWidth = 0, padded = false;
            for (i = 0; i < b.files.length; i++) {
                f = b.files[i];
                if (f.modified !== null && f.modified !== undefined && isFinite(f.modified)) { latest = latest === null ? f.modified : Math.max(latest, f.modified); }
                if (b.parts) {
                    if (i && f.frame === b.files[i - 1].frame) { duplicate = true; }
                    if (!i || f.frame !== b.files[i - 1].frame) { frames.push(f.frame); }
                    minWidth = Math.min(minWidth, f.width); maxWidth = Math.max(maxWidth, f.width);
                    if (f.width > String(f.frame).length) { padded = true; }
                }
            }
            // Filter whole sequences by latest frame, never remove individual frames.
            if (opts.ageMode) {
                if (latest === null) { continue; }
                var days = Math.max(0, now - latest) / 86400000;
                if ((opts.ageMode === 1 && days > opts.ageDays) || (opts.ageMode === 2 && days < opts.ageDays)) { continue; }
            }
            var seq = !!b.parts && (b.files.length > 1 || opts.numberedSingles), first = b.files[0], last = b.files[b.files.length - 1];
            if (opts.sequenceOnly && !seq) { continue; }
            var requiresAlphabetical = seq && /\d/.test(b.parts.suffix);
            result.push({ key: pathKey(dir) + "/" + k, folder: path(dir), relativeDir: relative(dir, root), firstPath: first.path,
                firstName: first.name, extension: ext(first.name), isSequence: seq, count: b.files.length, frames: frames,
                firstFrame: seq ? first.frame : null, lastFrame: seq ? last.frame : null,
                duplicateFrames: duplicate, mixedPadding: seq && padded && minWidth !== maxWidth,
                requiresAlphabetical: requiresAlphabetical,
                forceAlphabetical: requiresAlphabetical && minWidth === maxWidth && extensionBuckets["$" + ext(first.name)] === 1,
                gaps: seq ? last.frame - first.frame + 1 - frames.length : 0,
                displayName: seq ? b.parts.prefix + "[" + first.frame + "-" + last.frame + "]" + b.parts.suffix + "." + ext(first.name) : first.name });
        }
        return result;
    }
    function descriptor(item) {
        var file = item.file;
        if (!file && item.mainSource && item.mainSource.missingFootagePath) { file = new File(item.mainSource.missingFootagePath); }
        var name = file ? decode(file.name) : item.name;
        return { item: item, name: item.name, filename: name, folder: file ? path(file.parent.fsName) : "", extension: ext(name),
            isSequence: !!(file && has(IMAGES, ext(name)) && item.mainSource && !item.mainSource.isStill) };
    }
    function selectOnly(items) { for (var i = 1; i <= app.project.numItems; i++) { app.project.item(i).selected = false; } for (i = 0; i < items.length; i++) { items[i].selected = true; } }
    function validItem(item) { try { for (var i = 1; app.project && i <= app.project.numItems; i++) { if (app.project.item(i) === item) { return true; } } } catch (e) {} return false; }
    function childFolder(parent, name) {
        for (var i = 1; i <= parent.numItems; i++) { var item = parent.item(i); if (item instanceof FolderItem && item.name === name) { return item; } }
        var folder = app.project.items.addFolder(name); folder.parentFolder = parent; return folder;
    }
    function destination(asset, rootName, parent, hierarchy) {
        if (!hierarchy) { return parent; } var folder = childFolder(parent, rootName), a = asset.relativeDir.split("/");
        for (var i = 0; i < a.length; i++) { if (a[i]) { folder = childFolder(folder, a[i]); } } return folder;
    }
    function fps(source, value) { if (!source || source.isStill) { throw new Error("AE imported a still instead of an image sequence."); } source.conformFrameRate = value; }
    function check(asset) {
        if (asset.duplicateFrames || asset.mixedPadding) { throw new Error("Ambiguous frame numbering: " + asset.displayName + ". Normalize the padding/duplicates first."); }
        if (asset.requiresAlphabetical && (!asset.forceAlphabetical || asset.gaps)) { throw new Error("AE cannot safely infer the frame token before a numeric suffix here. Put version digits before the frame number, or isolate a contiguous, consistently padded sequence in its own folder: " + asset.displayName); }
        var file = new File(asset.firstPath); if (!file.exists) { throw new Error("File no longer exists: " + asset.firstPath); } return file;
    }
    function selected(list) { var out = []; for (var i = 0; i < list.items.length; i++) { if (list.items[i].selected) { out.push(list.items[i].data); } } return out; }
    function selectAll(list, flag) { for (var i = 0; i < list.items.length; i++) { list.items[i].selected = flag; } }
    function row(list, columns, data) { var r = list.add("item", String(columns[0])); for (var i = 1; i < columns.length; i++) { r.subItems[i - 1].text = String(columns[i]); } r.data = data; return r; }
    function group(parent) { var g = parent.add("group"); g.orientation = "row"; g.alignChildren = ["left", "center"]; return g; }
    function guard(fn) { return function () { try { fn(); } catch (e) { alert(e.toString(), TITLE); } }; }
    function button(parent, text, fn) { var b = parent.add("button", undefined, text); b.onClick = guard(fn); return b; }
    function field(parent, label, value, width) { parent.add("statictext", undefined, label); var f = parent.add("edittext", undefined, value); f.characters = width; return f; }
    function drop(parent, entries, index) { var d = parent.add("dropdownlist", undefined, entries); d.selection = index; return d; }
    function history(ui, root) { var a = [root]; for (var i = 0; i < ui.history.items.length; i++) { if (ui.history.items[i].text !== root) { a.push(ui.history.items[i].text); } }
        ui.updatingHistory = true;
        try { ui.history.removeAll(); for (i = 0; i < Math.min(8, a.length); i++) { ui.history.add("item", a[i]); save("recent" + i, a[i]); } ui.history.selection = 0; }
        finally { ui.updatingHistory = false; } }
    function scan(ui) {
        if (state.scanning) { return; } var root = new Folder(trim(ui.root.text)); if (!trim(ui.root.text) || !root.exists) { throw new Error("Choose an existing folder in Path."); }
        var opts = { extensions: exts(ui.allowed.text), folderMode: ui.folderMode.selection.text === "Include names" ? 1 : ui.folderMode.selection.text === "Exclude names" ? 2 : 0, words: terms(ui.folderWords.text), sensitive: ui.sensitive.value,
            ageMode: ui.ageMode.selection.text === "Newer than" ? 1 : ui.ageMode.selection.text === "Older than" ? 2 : 0, ageDays: num(ui.ageDays.text, "Age (days)", 0, 100000, false), numberedSingles: false, sequenceOnly: ui.sequenceOnly.value };
        if (!opts.extensions.length) { throw new Error("Enter allowed extensions."); }
        var job = { stack: [root], seen: {}, entries: null, cursor: 0, files: [], current: null, assets: [], errors: [], filesSeen: 0, folders: 0, now: new Date().getTime(), cancelled: false };
        state.review = null; state.scanning = true; state.job = job; ui.scan.enabled = false; ui.cancel.enabled = true; counts(ui);
        var runtime = $.global.AOVShuttleRuntime02 || {}; $.global.AOVShuttleRuntime02 = runtime; runtime.serial = (runtime.serial || 0) + 1; var slot = "scan" + runtime.serial;
        function finish(cancelled) {
            state.scanning = false; state.job = null; ui.scan.enabled = true; ui.cancel.enabled = false; delete runtime[slot];
            if (!cancelled) {
                state.scanReady = true;
                state.root = root; state.assets = job.assets; state.assets.sort(function (a, b) { return naturalCompare(a.displayName, b.displayName) || naturalCompare(a.relativeDir, b.relativeDir); });
                var wantedType = pref("showType05", "All"); ui.extension.removeAll(); ui.extension.add("item", "All"); var extensions = [];
                for (var i = 0; i < state.assets.length; i++) { if (!has(extensions, state.assets[i].extension)) { extensions.push(state.assets[i].extension); } }
                extensions.sort(); for (i = 0; i < extensions.length; i++) { ui.extension.add("item", extensions[i]); } ui.extension.selection = 0;
                for (i = 0; i < ui.extension.items.length; i++) { if (ui.extension.items[i].text === wantedType) { ui.extension.selection = i; } }
                showAssets(ui, false); history(ui, root.fsName);
                save("root", root.fsName); save("allowed", ui.allowed.text); save("folderMode", opts.folderMode); save("folderWords", ui.folderWords.text); save("sensitive", opts.sensitive ? "1" : "0"); save("ageMode", opts.ageMode); save("ageDays", opts.ageDays);
                ui.status.text = job.assets.length + " renders found. Select renders in step 3.";
                if (job.errors.length) { report({ count: job.assets.length, failures: job.errors }, "found", ui); }
            } else { ui.status.text = "Scan cancelled; previous results retained."; } counts(ui);
        }
        runtime[slot] = function () {
            try { var budget = 600, start = new Date().getTime();
                while (budget > 0 && new Date().getTime() - start < 100) {
                    if (job.cancelled) { finish(true); return; }
                    if (!job.entries) {
                        if (!job.stack.length) { finish(false); return; } job.current = job.stack.pop(); var key = "$" + pathKey(job.current.fsName);
                        if (own(job.seen, key)) { continue; } job.seen[key] = true;
                        if (opts.folderMode === 2 && folderMatch(decode(job.current.name), opts.words, opts.sensitive)) { continue; }
                        try { job.entries = job.current.getFiles(); if (job.current.error) { job.errors.push(job.current.fsName + ": " + job.current.error); } }
                        catch (e) { job.errors.push(job.current.fsName + ": " + e.toString()); continue; }
                        job.folders++; job.cursor = 0; job.files = [];
                    }
                    while (job.cursor < job.entries.length && budget-- > 0) {
                        var entry = job.entries[job.cursor++];
                        if (entry instanceof Folder) { if (!entry.alias) { job.stack.push(entry); } }
                        else if (entry instanceof File) {
                            job.filesSeen++; if (opts.folderMode === 1 && !folderMatch(decode(job.current.name), opts.words, opts.sensitive)) { continue; }
                            var name = decode(entry.name), modified = null; if (!has(opts.extensions, ext(name))) { continue; }
                            if (opts.ageMode) { try { var date = entry.modified; modified = date ? date.getTime() : null; } catch (e2) { job.errors.push(entry.fsName + ": modification time unavailable"); } }
                            job.files.push({ name: name, path: path(entry.fsName), modified: modified });
                        }
                    }
                    if (job.cursor >= job.entries.length) { var found = groupFiles(job.files, job.current.fsName, root.fsName, opts, job.now); for (var f = 0; f < found.length; f++) { job.assets.push(found[f]); } job.entries = null; job.files = []; }
                }
                ui.status.text = "Scanning " + job.filesSeen + " files in " + job.folders + " folders...";
                job.taskID = app.scheduleTask("$.global.AOVShuttleRuntime02." + slot + "()", 20, false);
            } catch (e) { finish(true); alert("Scan failed: " + e.toString(), TITLE); }
        }; runtime[slot]();
    }
    function naturalCompare(a, b) {
        var x = String(a).toLowerCase().match(/\d+|\D+/g) || [], y = String(b).toLowerCase().match(/\d+|\D+/g) || [], i;
        for (i = 0; i < Math.min(x.length, y.length); i++) {
            if (x[i] === y[i]) { continue; }
            var nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
            if (nx && ny) { var difference = Number(x[i]) - Number(y[i]); if (difference) { return difference; } }
            else { return x[i] < y[i] ? -1 : 1; }
        }
        return x.length - y.length;
    }
    function matchName(name, sequence) {
        // AE display names contain a frame range; it is not part of the shot name.
        var range = /\[\s*\d+\s*-\s*\d+\s*\]/;
        var p = sequence && !range.test(String(name)) ? parts(name) : null;
        var stem = (p ? p.prefix + p.suffix : String(name).replace(/\.[^.]+$/, "")).replace(range, "");
        return stem.toLowerCase()
            .replace(/(^|[^a-z0-9])(?:v|ver|version)[_. -]*\d+(?=$|[^a-z0-9])/g, "$1")
            .replace(/(^|[^a-z0-9])(?:19|20)\d{2}[-_.]?\d{2}[-_.]?\d{2}(?=$|[^a-z0-9])/g, "$1")
            .replace(/(^|[^a-z0-9])\d{6}(?=$|[^a-z0-9])/g, function (all, separator, offset, whole) {
                return /(?:shot|scene|sh|sc|cam|camera)[_. -]*$/i.test(whole.substring(0, offset + separator.length)) ? all : separator;
            })
            .replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, "")
            // Ignore workflow labels only at the start. Keep camera/shot IDs,
            // overview/closeup and every AOV suffix as matching requirements.
            .replace(/^(?:(?:playblast|cg|render|renders|preview) )+/, "");
    }
    function findCandidates(assets) {
        var result = [], audio = ["wav", "aif", "aiff", "mp3", "aac", "m4a", "flac", "ogg"];
        for (var i = 1; app.project && i <= app.project.numItems; i++) {
            var item = app.project.item(i); if (!(item instanceof FootageItem)) { continue; }
            var target = descriptor(item), oldKey = matchName(target.filename, target.isSequence), customKey = matchName(target.name, target.isSequence);
            for (var j = 0; j < assets.length; j++) {
                if (item.file && pathKey(item.file.fsName) === pathKey(assets[j].firstPath)) { continue; } // Already uses this render.
                var key = matchName(assets[j].firstName, assets[j].isSequence);
                if (!key || (key !== oldKey && key !== customKey)) { continue; }
                if (!!item.hasVideo === has(audio, assets[j].extension)) { continue; }
                result.push({ target: target, asset: assets[j], key: key });
            }
        }
        for (i = 0; i < result.length; i++) {
            var oldCount = 0, newCount = 0;
            for (j = 0; j < result.length; j++) { if (result[j].target.item === result[i].target.item) { oldCount++; } if (result[j].asset === result[i].asset) { newCount++; } }
            result[i].ambiguous = oldCount > 1 || newCount > 1;
            result[i].approved = !result[i].ambiguous;
            result[i].oldPath = result[i].target.item.file ? pathKey(result[i].target.item.file.fsName) : "";
            result[i].oldName = result[i].target.item.name;
        }
        return result;
    }
    function validatePairs(pairs, project) {
        if (!pairs.length) { throw new Error("Choose at least one replacement in Compare and confirm."); }
        if (app.project !== project) { throw new Error("Project changed. Compare again."); }
        var usedTargets = [], usedAssets = [];
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i], item = pair.target.item;
            if (has(usedTargets, item) || has(usedAssets, pair.asset)) { throw new Error("A clip or new render is used twice. Choose one match for each in the review."); }
            if (!validItem(item) || item.name !== pair.oldName || (item.file ? pathKey(item.file.fsName) : "") !== pair.oldPath) { throw new Error("A project source changed since comparison. Compare again."); }
            check(pair.asset); usedTargets.push(item); usedAssets.push(pair.asset);
        }
    }
    function applyAlpha(item, opts) {
        if (!opts.alpha || !item.mainSource.hasAlpha) { return; }
        var previous = item.mainSource.alphaMode, previousMatte = previous === AlphaMode.PREMULTIPLIED ? item.mainSource.premulColor : null, previousInvert = item.mainSource.invertAlpha;
        item.mainSource.alphaMode = opts.alpha === 1 ? AlphaMode.IGNORE : opts.alpha === 2 ? AlphaMode.STRAIGHT : AlphaMode.PREMULTIPLIED;
        if (opts.alpha === 1 && item.mainSource.alphaMode !== AlphaMode.IGNORE) {
            item.mainSource.alphaMode = previous;
            if (previousMatte) { item.mainSource.premulColor = previousMatte; }
            item.mainSource.invertAlpha = previousInvert;
            throw new Error("This AE build did not retain scripted Ignore alpha. Footage was imported with its previous interpretation. Set Ignore manually in Interpret Footage > Main, or use Automatic / Straight / Premultiplied.");
        }
        if (opts.alpha === 3) { item.mainSource.premulColor = opts.matte; }
    }
    function importOne(asset, opts, parent) {
        var io = new ImportOptions(check(asset)); if (!io.canImportAs(ImportAsType.FOOTAGE)) { throw new Error("AE cannot import this format as footage."); }
        io.importAs = ImportAsType.FOOTAGE; io.sequence = asset.isSequence; io.forceAlphabetical = !!asset.forceAlphabetical;
        var item = app.project.importFile(io);
        try {
            item.parentFolder = destination(asset, decode(state.root.name), parent, opts.hierarchy);
            if (!item.mainSource.isStill && item.hasVideo) { fps(item.mainSource, opts.fps); }
            applyAlpha(item, opts);
        } catch (e) { e.importedItem = item; throw e; }
        return item;
    }
    function compositionShot(item) {
        var name = String(item.name), range = /\[\s*\d+\s*-\s*\d+\s*\]/;
        var sequence = !item.mainSource.isStill && item.file && /\.(exr|png|jpe?g|tiff?|tga|dpx|cin|hdr|sgi|rgb|rla|rpf)$/i.test(item.file.name);
        var p = sequence && !range.test(name) ? parts(name) : null;
        var stem = p ? p.prefix + p.suffix : name.replace(/\.[^.]+$/, "");
        stem = stem.replace(range, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, "");
        // Preserve shot/camera IDs, versions and dates. Strip only known trailing AOV names.
        var pass = / (?:ao|ambient ?occlusion|crypto(?:material|obj|object|matte| material| object| matte)?|specualr|specular(?:lighting| lighting| direct| indirect| filter)?|diffuse(?:lighting| lighting| direct| indirect| filter| color)?|reflection(?:s| filter)?|refraction(?:s| filter)?|transmission|shadow(?:s)?|beauty|rgba|rgb|combined|albedo|normal(?:s)?|depth|zdepth|z depth|position|world position|motion vectors?|velocity|emission|emissive|self illumination|sss|subsurface(?: scattering)?|lighting|direct lighting|indirect lighting|object id|material id)(?: \d+)?$/;
        return stem.replace(pass, "") || stem;
    }
    function compositionPlan(items, opts, resolution) {
        if (!items.length) { throw new Error("No footage was imported."); }
        var clips = items.slice(0); clips.sort(function (a, b) { return naturalCompare(a.name, b.name) || a.id - b.id; });
        var width = num(resolution.width, "Composition width", 4, 30000, true), height = num(resolution.height, "Composition height", 4, 30000, true), frames = 0, entries = [], shots = [];
        for (var i = 0; i < clips.length; i++) {
            var item = clips[i], seconds = item.mainSource.isStill ? 1 : item.duration;
            if (!isFinite(seconds) || seconds <= 0) { throw new Error("Invalid duration: " + item.name); }
            var length = Math.max(1, Math.ceil(seconds * opts.fps - 0.000001));
            var key = compositionShot(item), shot = null;
            for (var j = 0; j < shots.length; j++) { if (shots[j].key === key) { shot = shots[j]; break; } }
            if (!shot) { shot = { key: key, length: 0, clips: [] }; shots.push(shot); }
            shot.clips.push({ item: item, length: length }); shot.length = Math.max(shot.length, length);
        }
        shots.sort(function (a, b) { return naturalCompare(a.key, b.key); });
        for (i = 0; i < shots.length; i++) {
            for (j = 0; j < shots[i].clips.length; j++) { var clip = shots[i].clips[j]; entries.push({ item: clip.item, start: frames / opts.fps, end: (frames + clip.length) / opts.fps, shot: shots[i].key }); }
            frames += shots[i].length;
        }
        if (frames / opts.fps > 10800) { throw new Error("Combined clips exceed AE's three-hour composition limit."); }
        return { width: width, height: height, fps: opts.fps, duration: frames / opts.fps, entries: entries, fit: opts.fit };
    }
    function makeComposition(items, opts, resolution) {
        var plan = compositionPlan(items, opts, resolution), comp = app.project.items.addComp("Renders - " + decode(state.root.name), plan.width, plan.height, 1, plan.duration, plan.fps);
        opts.effectWarnings = [];
        for (var i = 0; i < plan.entries.length; i++) {
            var entry = plan.entries[i], layer = comp.layers.add(entry.item);
            layer.startTime = entry.start; layer.inPoint = entry.start; layer.outPoint = entry.end; layer.moveToEnd();
            if (entry.item.hasVideo) {
                var transform = layer.property("ADBE Transform Group");
                transform.property("ADBE Position").setValue([plan.width / 2, plan.height / 2]);
                if (plan.fit) { var scale = 100 * Math.min(plan.width / (entry.item.width * entry.item.pixelAspect), plan.height / entry.item.height); transform.property("ADBE Scale").setValue([scale, scale]); }
                if (isCryptoSequence(entry.item)) { try { addCryptomatte(layer); } catch (cryptoError) { opts.effectWarnings.push(entry.item.name + ": " + cryptoError.toString()); } }
            }
        }
        comp.workAreaStart = 0; comp.workAreaDuration = plan.duration; return comp;
    }
    function resolutions(items) {
        var sizes = [];
        for (var i = 0; i < items.length; i++) {
            if (!items[i].hasVideo) { continue; }
            var width = Math.round(items[i].width * items[i].pixelAspect), height = items[i].height, found = false;
            for (var j = 0; j < sizes.length; j++) { if (sizes[j].width === width && sizes[j].height === height) { found = true; } }
            if (!found) { sizes.push({ width: width, height: height }); }
        }
        sizes.sort(function (a, b) { return b.width * b.height - a.width * a.height; }); return sizes;
    }
    function chooseResolution(items) {
        var sizes = resolutions(items); if (sizes.length === 1) { return sizes[0]; }
        var w = new Window("dialog", TITLE + " - Composition resolution"); w.orientation = "column"; w.alignChildren = "fill";
        w.add("statictext", undefined, sizes.length ? "These clips have different resolutions. Choose the shared composition size." : "Audio-only selection: choose a composition size.");
        var labels = []; for (var i = 0; i < sizes.length; i++) { labels.push(sizes[i].width + " x " + sizes[i].height); } labels.push("Custom");
        var savedWidth = Number(pref("compWidth", "0")), savedHeight = Number(pref("compHeight", "0")), initial = 0;
        if (savedWidth > 0 && savedHeight > 0) { initial = sizes.length; for (i = 0; i < sizes.length; i++) { if (sizes[i].width === savedWidth && sizes[i].height === savedHeight) { initial = i; } } }
        var choice = drop(w, labels, initial), r = group(w), width = field(r, "Width", String(savedWidth || (sizes.length ? sizes[0].width : 1920)), 7), height = field(r, "Height", String(savedHeight || (sizes.length ? sizes[0].height : 1080)), 7), result = null;
        choice.onChange = function () { for (var j = 0; j < sizes.length; j++) { if (choice.selection.text === labels[j]) { width.text = String(sizes[j].width); height.text = String(sizes[j].height); } } };
        r = group(w); button(r, "Use resolution", function () { result = { width: num(width.text, "Width", 4, 30000, true), height: num(height.text, "Height", 4, 30000, true) }; save("compWidth", result.width); save("compHeight", result.height); w.close(1); }); w.add("button", undefined, "Cancel", { name: "cancel" });
        theme(w); w.show(); return result;
    }
    function importBatch(assets, opts, toComp) {
        if (!assets.length) { throw new Error("Select renders first."); } for (var p = 0; p < assets.length; p++) { check(assets[p]); }
        if (!app.project) { app.newProject(); }
        var parent = app.project.rootFolder, projectSelection = app.project.selection, folders = [];
        for (var s = 0; s < projectSelection.length; s++) { if (projectSelection[s] instanceof FolderItem) { folders.push(projectSelection[s]); } } if (folders.length === 1) { parent = folders[0]; }
        var imported = [], failures = [], comp = null, cancelled = false;
        app.beginUndoGroup(TITLE + (toComp ? " - Import sequential composition" : " - Import"));
        try {
            for (var i = 0; i < assets.length; i++) { try { imported.push(importOne(assets[i], opts, parent)); } catch (e) { if (e.importedItem) { imported.push(e.importedItem); } failures.push(assets[i].displayName + ": " + e.toString()); } }
            if (toComp && imported.length) {
                if (failures.length) { failures.push("Composition not created because some imports/settings failed. Imported footage remains available."); }
                else { var resolution = chooseResolution(imported); if (resolution) { try { comp = makeComposition(imported, opts, resolution); failures = failures.concat(opts.effectWarnings || []); } catch (e2) { failures.push("Composition: " + e2.toString() + ". Use Undo if a partial composition was created."); } } else { cancelled = true; } }
            }
            selectOnly(comp ? [comp] : imported);
        } finally { app.endUndoGroup(); }
        if (comp) { comp.openInViewer(); }
        return { count: imported.length, failures: failures, comp: comp, cancelled: cancelled };
    }
    function replaceBatch(pairs, project) {
        validatePairs(pairs, project); var failures = [], done = 0;
        app.beginUndoGroup(TITLE + " - Replace project clips");
        try {
            for (var i = 0; i < pairs.length; i++) { try {
                var item = pairs[i].target.item, file = check(pairs[i].asset);
                var previousFPS = item.mainSource.isStill ? Number(pref("fps", "25")) : item.frameRate;
                if (pairs[i].asset.isSequence) { item.replaceWithSequence(file, !!pairs[i].asset.forceAlphabetical); } else { item.replace(file); }
                if (pairs[i].asset.isSequence && previousFPS > 0 && previousFPS <= 99) { fps(item.mainSource, previousFPS); }
                item.name = pairs[i].asset.displayName;
                // A retained, enabled old proxy must not hide the new main source.
                item.useProxy = false; done++;
            } catch (e) { failures.push(pairs[i].target.name + ": " + e.toString()); } }
        } finally { app.endUndoGroup(); }
        return { count: done, failures: failures };
    }
    function isCryptoSequence(item) { return !!(item && item.file && /\.exr$/i.test(item.file.name) && /crypto/i.test(item.file.name + " " + item.name) && !item.mainSource.isStill); }
    function addCryptomatte(layer) {
        var effects = layer.property("ADBE Effect Parade");
        for (var i = 1; i <= effects.numProperties; i++) { if (effects.property(i).matchName === "Cryptomatte") { return; } }
        if (!effects.canAddProperty("Cryptomatte")) { throw new Error("Cryptomatte is unavailable. The layer was imported; add the effect manually after enabling the plug-in."); }
        effects.addProperty("Cryptomatte");
    }
    var SRGB_RECOVER = "BISI - Recover encoded sRGB", SRGB_INVERSE = "BISI - Preserve sRGB appearance";
    var CST = "ADBE OCIO Color Space Transform", DISPLAY = "ADBE OCIO Display Transform";
    function setOCIOChoice(effect, suffix, labels) {
        var property = effect.property(effect.matchName + suffix), menu, index = -1;
        try { menu = property.propertyParameters; } catch (e) {}
        if (!menu || !menu.length) { throw new Error("This AE version cannot read OCIO menu labels. AE 26 or newer is required; no menu indices will be guessed."); }
        for (var l = 0; l < labels.length && index < 0; l++) { for (var i = 0; i < menu.length; i++) { if (String(menu[i]) === labels[l]) { index = i; break; } } }
        if (index < 0) { throw new Error("OCIO choice unavailable: " + labels[0] + ". Check the ACES configuration."); }
        property.setValue(index + 1);
        if (property.value !== index + 1 || String(property.valueText) !== String(menu[index])) { throw new Error("AE did not retain OCIO choice: " + menu[index]); }
    }
    function srgbContext() {
        if (!app.project || app.project.colorManagementSystem !== 1 || app.project.ocioConfigurationFile !== "ACES 1.3 CG v1.0" || !/^(ACES\/ACEScg|ACEScg|scene_linear: ACEScg)$/.test(app.project.workingSpace) || app.project.bitsPerChannel !== 32) {
            throw new Error("Use OCIO / ACES 1.3 CG v1.0 / ACEScg working space / 32 bpc first. The ACES button explains the remaining project settings.");
        }
    }
    function srgbLayerReason(layer) {
        if (!layer || !(layer.source instanceof FootageItem) || !layer.source.file || !layer.source.hasVideo) { return "not file-based image/video footage"; }
        if (!/\.(png|jpe?g|psd|tiff?|bmp|tga|mov|mp4|m4v|avi)$/i.test(layer.source.file.name)) { return "not a supported sRGB candidate (EXR/data passes are excluded)"; }
        if (layer.locked) { return "layer is locked"; }
        if (layer.source.useProxy) { return "proxy is enabled; switch to the main source first"; }
        var effects = layer.property("ADBE Effect Parade");
        if (!effects || !effects.canAddProperty(CST) || !effects.canAddProperty(DISPLAY)) { return "native OCIO effects are unavailable"; }
        for (var i = 1; i <= effects.numProperties; i++) {
            var fx = effects.property(i);
            if (fx.name === SRGB_INVERSE || fx.name === SRGB_RECOVER || fx.name === "AOV - Recover encoded sRGB" || fx.name === "AOV - Preserve sRGB appearance") { return "already has a BISI sRGB correction; inspect it rather than adding another"; }
            if (/OCIO|OpenColorIO|Color Profile Converter|ADBE Color Profile Converter/i.test(fx.matchName + " " + fx.name)) { return "already has a color-space transform; review it manually to avoid double conversion"; }
        }
        return "";
    }
    function applySRGBLayers(layers, interpretation, comp) {
        srgbContext();
        var choices = {
            texture: ["Utility/sRGB - Texture", "sRGB - Texture"],
            aces2065: ["ACES/ACES2065-1", "ACES2065-1"],
            acescg: ["ACES/ACEScg", "ACEScg", "scene_linear: ACEScg"]
        };
        if (!choices[interpretation] && interpretation !== "raw") { throw new Error("Choose the current AE input interpretation first."); }
        if (!comp || app.project.activeItem !== comp || !(comp instanceof CompItem)) { throw new Error("Active composition changed. Select the layers again."); }
        if (!layers.length) { throw new Error("Select image/video layers in the timeline first."); }
        // Check the entire batch before the first mutation.
        for (var i = 0; i < layers.length; i++) { var reason = srgbLayerReason(layers[i]); if (layers[i].containingComp !== comp || reason) { throw new Error(layers[i].name + ": " + (reason || "layer left the active composition")); } }
        var changed = [], failures = [], success = false;
        app.beginUndoGroup(TITLE + " - Preserve sRGB appearance");
        try {
            for (i = 0; i < layers.length; i++) {
                var layer = layers[i], effects = layer.property("ADBE Effect Parade"), fx, record = { layer: layer, names: [] }; changed.push(record);
                if (interpretation !== "raw") {
                    fx = effects.addProperty(CST); fx.name = SRGB_RECOVER; record.names.push(SRGB_RECOVER);
                    setOCIOChoice(fx, "-0001", choices.acescg); setOCIOChoice(fx, "-0002", choices[interpretation]); fx.moveTo(1);
                }
                // Adding an effect invalidates indexed Property references: reacquire the group.
                effects = layer.property("ADBE Effect Parade"); fx = effects.addProperty(DISPLAY); fx.name = SRGB_INVERSE; record.names.push(SRGB_INVERSE);
                setOCIOChoice(fx, "-0001", choices.acescg);
                setOCIOChoice(fx, "-0002", ["sRGB - Display"]);
                setOCIOChoice(fx, "-0003", ["ACES 1.0 - SDR Video"]);
                fx.property(DISPLAY + "-0004").setValue(1);
                if (fx.property(DISPLAY + "-0004").value !== 1) { throw new Error("AE did not enable the inverse display transform."); }
                fx.moveTo(interpretation === "raw" ? 1 : 2);
            }
            success = true;
        } catch (e) {
            failures.push(e.toString());
            // Roll back only effects made by this invocation, never existing user effects.
            for (var c = changed.length - 1; c >= 0; c--) {
                for (var n = changed[c].names.length - 1; n >= 0; n--) { try { var own = changed[c].layer.property("ADBE Effect Parade").property(changed[c].names[n]); if (own) { own.remove(); } } catch (rollbackError) { failures.push("Rollback failed: " + changed[c].layer.name + ". Use Undo."); } }
            }
        } finally { app.endUndoGroup(); }
        return { count: success ? layers.length : 0, failures: failures };
    }
    function srgbInputImage(parent) {
        var file = resourceFile("BISI-sRGB-input-guide.png");
        if (file.exists && typeof ScriptUI !== "undefined") {
            var view = parent.add("image", undefined, ScriptUI.newImage(file)); view.alignment = ["center", "top"]; view.aovPixelScale = 1;
            sizeSRGBImage(view, parent);
            view.onDraw = function () {
                var g = this.graphics, scale = this.aovPixelScale, nativeSize = this.image.size;
                // Cancel AE's logical-to-screen enlargement for this bitmap only.
                g.drawImage(this.image, 0, 0, nativeSize.width / scale, nativeSize.height / scale);
                g.newPath(); g.rectPath(168 / scale, 97 / scale, 205 / scale, 29 / scale);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [1, 0.18, 0.7, 1], 2 / scale));
            };
            return view;
        }
        return null;
    }
    function sizeSRGBImage(view, window) {
        if (!view) { return false; }
        var scale = 1;
        try {
            var pixels = window.windowBounds, logical = window.size;
            if (pixels && logical.width > 0) {
                // Round out native window-bound pixel rounding (e.g. 905/603 at 150%).
                var measured = Math.round(pixels.width / logical.width * 100) / 100;
                if (measured >= 1 && measured <= 4) { scale = measured; }
            }
        } catch (e) {}
        var nativeSize = view.image.size, width = Math.ceil(nativeSize.width / scale), height = Math.ceil(nativeSize.height / scale);
        var changed = view.aovPixelScale !== scale || view.preferredSize.width !== width || view.preferredSize.height !== height;
        view.aovPixelScale = scale;
        view.preferredSize = [width, height]; view.minimumSize = [width, height]; view.maximumSize = [width, height];
        return changed;
    }
    function srgbHelp() {
        var w = new Window("dialog", TITLE + " - sRGB help and export"); w.orientation = "column"; w.alignChildren = ["fill", "top"];
        w.add("statictext", undefined, "Use only for known sRGB images/video, not log, HDR, P3 or Rec.709 sources.");
        w.add("statictext", undefined, "No override? Read Media Color Space instead. Preserve RGB checked? Choose Preserve RGB / Raw.");
        w.add("statictext", undefined, "Different settings across sources? Correct each matching group separately.");
        w.add("statictext", undefined, "Already using sRGB - Display / ACES 1.0 - SDR Video as input? Do not add this correction.");
        w.add("statictext", undefined, "Viewer and SDR export: sRGB - Display / ACES 1.0 - SDR Video.");
        w.add("statictext", undefined, "Render Queue > Output Module > Color: choose that same output transform once.");
        w.add("statictext", undefined, "For the supplied SDR recipe, disable Embed color space. Not for scene-linear EXR export.");
        w.add("statictext", undefined, "Files are unchanged. Existing creative effects remain after the correction; grading can change the look.");
        w.add("button", undefined, "Close", { name: "cancel" }); theme(w); w.show();
    }
    function srgbDialog(ui) {
        srgbContext(); var comp = app.project.activeItem;
        if (!(comp instanceof CompItem) || !comp.selectedLayers.length) { throw new Error("Select sRGB image/video layers in the timeline, then click Match sRGB in ACES."); }
        var layers = [], summary = [], skipped = [];
        for (var i = 0; i < comp.selectedLayers.length; i++) { var layer = comp.selectedLayers[i], reason = srgbLayerReason(layer); if (reason) { skipped.push(layer.name + " - " + reason); } else { layers.push(layer); summary.push(layer.name + "\n  " + layer.source.file.fsName); } }
        if (!layers.length) { throw new Error("No eligible selected layers.\n\n" + skipped.join("\n")); }
        var w = new Window("dialog", TITLE + " - Match sRGB in ACES"); w.orientation = "column"; w.alignChildren = ["fill", "top"]; w.spacing = 8; w.margins = 14;
        var heading = group(w); heading.alignment = ["fill", "top"];
        heading.add("statictext", undefined, layers.length + " selected layer(s) to correct");
        var helpGap = heading.add("group"); helpGap.alignment = ["fill", "center"]; button(heading, "Help / export...", srgbHelp);
        w.add("edittext", undefined, summary.join("\n\n") + (skipped.length ? "\n\nSKIPPED\n" + skipped.join("\n") : ""), { readonly: true, multiline: true, scrolling: true }).preferredSize = [640, 72];
        w.add("statictext", undefined, "1. Project panel: right-click source > Interpret Footage > Main > Color.");
        var inputImage = srgbInputImage(w);
        w.add("statictext", undefined, "Example only. Read your current setting; do not change it.");
        w.add("statictext", undefined, "2. Match Override Media Color Space below (or Media Color Space if no override).");
        var input = drop(w, ["Choose the value shown in AE...", "Utility/sRGB - Texture", "ACES/ACES2065-1 (including default ACES2065-1)", "ACES/ACEScg", "Preserve RGB enabled / Utility/Raw", "sRGB - Display / ACES 1.0 - SDR Video (already matched)", "Other / not sure"], 0); input.alignment = ["fill", "center"];
        var consent = w.add("checkbox", undefined, "All listed layers are sRGB and use this same setting.");
        var hint = w.add("statictext", undefined, "3. Confirm the setting, then apply the correction.");
        var r = group(w); r.alignment = ["fill", "top"]; r.alignChildren = ["fill", "center"];
        var apply = button(r, "Apply sRGB correction", function () {
            if (!consent.value || !input.selection || input.selection.index < 1 || input.selection.index > 4) { return; }
            var result = applySRGBLayers(layers, ["", "texture", "aces2065", "acescg", "raw"][input.selection.index], comp);
            w.close(1); report(result, "corrected for the sRGB ACES view", ui);
        }); apply.primary = true; actionSize(apply, 36); apply.enabled = false;
        var cancel = r.add("button", undefined, "Cancel", { name: "cancel" }); actionSize(cancel, 36);
        input.onChange = consent.onClick = function () {
            var index = input.selection ? input.selection.index : 0;
            apply.enabled = !!(consent.value && index > 0 && index < 5);
            if (index === 5) { hint.text = "Already matched: no additional correction needed. Click Cancel."; }
            else if (index === 6) { hint.text = "Do not guess. Check the source setting before applying a correction."; }
            else { hint.text = "3. Confirm the setting, then apply the correction."; }
        };
        w.onShow = w.onResize = function () {
            if (sizeSRGBImage(inputImage, w)) { w.layout.layout(true); }
            var half = Math.floor((r.size.width - r.spacing) / 2); if (half > 0) { apply.location = [0, 0]; apply.size = [half, 36]; cancel.location = [half + r.spacing, 0]; cancel.size = [r.size.width - half - r.spacing, 36]; }
        };
        theme(w); w.show();
    }
    function theme(control) {
        try { var g = control.graphics; g.backgroundColor = g.newBrush(g.BrushType.SOLID_COLOR, control.aovBackground || (control.type === "edittext" || control.type === "listbox" ? [0.06, 0.06, 0.06, 1] : [0.13, 0.13, 0.13, 1])); g.foregroundColor = g.newPen(g.PenType.SOLID_COLOR, [0.82, 0.82, 0.82, 1], 1); } catch (e) {}
        if (control.type === "button") {
            control.preferredSize.height = control.actionHeight || 28;
            control.onDraw = function () {
                var g = this.graphics, size = this.size, enabled = this.enabled;
                for (var p = this.parent; enabled && p; p = p.parent) { enabled = p.enabled; }
                var color = this.primary && enabled ? [0, 0.38, 0.9, 1] : [0.18, 0.18, 0.18, 1];
                g.newPath(); g.rectPath(0, 0, size.width, size.height); g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, color));
                g.newPath(); g.rectPath(0.5, 0.5, size.width - 1, size.height - 1); g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [0.32, 0.32, 0.32, 1], 1));
                var textSize = g.measureString(this.text, g.font), tw = textSize.width || textSize[0], th = textSize.height || textSize[1];
                g.drawString(this.text, g.newPen(g.PenType.SOLID_COLOR, enabled ? [1, 1, 1, 1] : [0.48, 0.48, 0.48, 1], 1), Math.max(5, (size.width - tw) / 2), (size.height - th) / 2, g.font);
            };
        }
        if (control.children) { for (var i = 0; i < control.children.length; i++) { theme(control.children[i]); } }
    }
    function section(parent, title) { var p = parent.add("panel", undefined, title); p.orientation = "column"; p.alignChildren = ["fill", "top"]; p.margins = 10; p.spacing = 7; return p; }
    function actionSize(control, height) { control.actionHeight = height; control.alignment = ["fill", "center"]; control.preferredSize.height = height; control.minimumSize.height = height; control.maximumSize.height = height; }
    function hide(control, flag, width) {
        function dimensions(value, fallback) { return [value.width !== undefined ? value.width : value[0] !== undefined ? value[0] : fallback, value.height !== undefined ? value.height : value[1] !== undefined ? value[1] : fallback]; }
        if (!control.aovOriginalLayout) { control.aovOriginalLayout = { preferred: dimensions(control.preferredSize, -1), minimum: dimensions(control.minimumSize, 0), maximum: dimensions(control.maximumSize, 10000) }; }
        var original = control.aovOriginalLayout;
        control.visible = !flag;
        control.maximumSize = flag ? [0, 0] : original.maximum;
        control.minimumSize = flag ? [0, 0] : [Math.max(width || 0, original.minimum[0]), original.minimum[1]];
        control.preferredSize = flag ? [0, 0] : original.preferred;
    }
    function acesGuide(show) {
        var w = new Window("dialog", TITLE + " - Finish ACES setup"); w.orientation = "column"; w.alignChildren = ["fill", "top"];
        w.add("statictext", undefined, "1. Open File > Project Settings > Color.");
        w.add("statictext", undefined, "2. Working Color Space: ACES/ACEScg");
        w.add("statictext", undefined, "3. Display Color Space: sRGB - Display / ACES 1.0 - SDR Video");
        var file = resourceFile("BISI-ACES-guide.png");
        if (file.exists && typeof ScriptUI !== "undefined") {
            var view = w.add("image", undefined, ScriptUI.newImage(file)); view.preferredSize = [680, 516]; view.minimumSize = [680, 516]; view.maximumSize = [680, 516];
            view.onDraw = function () {
                var g = this.graphics; g.drawImage(this.image, 0, 0, 680, 516);
                var pen = g.newPen(g.PenType.SOLID_COLOR, [1, 0.18, 0.7, 1], 3);
                g.newPath(); g.rectPath(196, 315, 435, 31); g.strokePath(pen);
                g.newPath(); g.rectPath(196, 477, 435, 30); g.strokePath(pen);
                g.newPath(); g.rectPath(1, 1, 678, 514); g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [1, 1, 1, 1], 2));
            };
        } else { w.add("statictext", undefined, "Reference screenshot unavailable. The exact required values are listed above."); }
        var r = group(w); r.alignment = ["fill", "top"]; r.alignChildren = ["fill", "center"];
        var open = button(r, "Open settings, then click Color", function () { w.close(); openProjectSettings(); }); actionSize(open, 32);
        var close = r.add("button", undefined, "Close", { name: "cancel" }); actionSize(close, 32);
        w.margins = 14; w.spacing = 8;
        w.onShow = function () { var half = Math.floor((r.size.width - r.spacing) / 2); if (half > 0) { open.location = [0, 0]; open.size = [half, 32]; close.location = [half + r.spacing, 0]; close.size = [half, 32]; } };
        theme(w); if (show !== false) { w.show(); } return w;
    }
    function isReplace(ui) { return ui.mode.selection && ui.mode.selection.text === "Replace"; }
    function invalidate(ui) { state.review = null; state.reviewProject = null; if (ui.replace) { ui.replace.enabled = false; } }
    function counts(ui) {
        var n = selected(ui.files).length, replacing = isReplace(ui), busy = state.scanning, ready = state.scanReady && !busy;
        ui.count.text = n + " selected / " + ui.files.items.length + " found";
        ui.browsers.enabled = ui.importSettings.enabled = ui.actions.enabled = ready;
        ui.files.enabled = ui.targets.enabled = ready;
        ui.importAction.enabled = ui.compAction.enabled = ready && !replacing && n > 0;
        ui.compare.enabled = ready && replacing && state.candidates.length > 0 && selected(ui.targets).length > 0;
        ui.replace.enabled = ready && replacing && !!state.review && state.review.length > 0;
        ui.root.enabled = ui.browse.enabled = ui.history.enabled = ui.filters.enabled = ui.filterButton.enabled = !busy;
    }
    function requireScan(ui) {
        state.scanReady = false; state.assets = []; state.targets = []; state.candidates = [];
        ui.files.removeAll(); ui.targets.removeAll(); invalidate(ui); counts(ui);
        ui.status.text = "Choose a path, then click Scan.";
    }
    function refreshCandidates(ui) {
        invalidate(ui); ui.targets.removeAll(); state.candidates = isReplace(ui) ? findCandidates(selected(ui.files)) : [];
        state.targets = [];
        for (var i = 0; i < state.candidates.length; i++) {
            var target = state.candidates[i].target, found = false;
            for (var j = 0; j < state.targets.length; j++) { if (state.targets[j].item === target.item) { found = true; } }
            if (!found) { state.targets.push(target); row(ui.targets, [target.name, target.folder], target).selected = true; }
        }
        ui.targetCount.text = !selected(ui.files).length ? "Select new renders on the left first." : state.targets.length ? state.targets.length + " matching project clips" : "No matching project clips found.";
        counts(ui);
    }
    function showAssets(ui, preserve) {
        var old = preserve ? selected(ui.files) : [], filter = ui.extension.selection ? ui.extension.selection.text : "All"; ui.files.removeAll();
        for (var i = 0; i < state.assets.length; i++) {
            var a = state.assets[i]; if (filter !== "All" && a.extension !== filter) { continue; }
            var label = a.duplicateFrames || a.mixedPadding ? "NUMBERING!" : a.gaps ? "GAPS: " + a.gaps : a.isSequence ? "Sequence" : "File";
            row(ui.files, [a.displayName, a.isSequence ? a.count : "-", a.relativeDir || ".", label], a).selected = has(old, a);
        }
        refreshCandidates(ui);
    }
    function report(result, verb, ui) {
        ui.status.text = result.count + " clip(s) " + verb + (result.comp ? "; sequential composition created." : result.cancelled ? "; composition cancelled, footage kept." : ".") + (result.failures.length ? " Check report." : "");
        if (result.failures.length) {
            var w = new Window("dialog", TITLE + " - Report"); w.orientation = "column"; w.alignChildren = "fill";
            w.add("edittext", undefined, result.failures.join("\n\n"), { multiline: true, readonly: true, scrolling: true }).preferredSize = [640, 200]; w.add("button", undefined, "Close", { name: "ok" }); theme(w); w.show();
        }
    }
    function review(ui, show) {
        var targets = selected(ui.targets), pairs = [], project = app.project;
        // Review a draft: cancelling must not change the candidate or confirmed selection.
        for (var i = 0; i < state.candidates.length; i++) {
            var candidate = state.candidates[i];
            if (has(targets, candidate.target)) {
                var approved = candidate.approved;
                if (state.review) { approved = false; for (var j = 0; j < state.review.length; j++) { if (state.review[j].asset === candidate.asset && state.review[j].target.item === candidate.target.item) { approved = true; } } }
                pairs.push({ asset: candidate.asset, target: candidate.target, ambiguous: candidate.ambiguous, approved: approved, oldPath: candidate.oldPath, oldName: candidate.oldName });
            }
        }
        if (!pairs.length) { throw new Error("Select new renders on the left, then matching project clips on the right."); }
        var kind = "dialog"; if (show === false) { kind = "palette"; }
        var w = new Window(kind, TITLE + " - Compare and confirm", undefined, { resizeable: true }); w.orientation = "column"; w.alignChildren = ["fill", "top"];
        w.margins = 14; w.spacing = 10; w.minimumSize = [760, 540];
        w.add("statictext", undefined, "Tick the replacements to include. Nothing is replaced until the final button in step 5.");
        var header = group(w); header.spacing = 8; header.margins = [8, 0, 26, 0];
        header.add("statictext", undefined, "Use").preferredSize.width = 28;
        var newHeader = header.add("statictext", undefined, "New render"), oldHeader = header.add("statictext", undefined, "Existing project clip");
        var table = group(w); table.alignChildren = ["fill", "fill"]; table.spacing = 6; table.alignment = ["fill", "fill"];
        var rows = section(table, ""); rows.margins = 8; rows.spacing = 0; rows.alignment = ["fill", "fill"];
        rows.aovBackground = [0.055, 0.055, 0.055, 1];
        function gridRow(line, tick, fresh, existing, index) {
            var shade = index % 2 ? 0.095 : 0.075;
            line.aovBackground = tick.aovBackground = fresh.aovBackground = existing.aovBackground = [shade, shade, shade, 1];
        }
        function separator(parent) { var p = parent.add("panel"); p.aovBackground = [0.25, 0.25, 0.25, 1]; p.margins = 0; return p; }
        // ScriptUI listboxes cannot host native checkboxes. Reuse eight real control rows
        // with a scrollbar, keeping all selection state in pairs (not in visible controls).
        var slots = [], pageSize = 8, scroll = table.add("scrollbar", undefined, 0, 0, Math.max(0, pairs.length - pageSize));
        scroll.preferredSize.width = 16; scroll.minimumSize.width = 16; scroll.maximumSize.width = 16;
        scroll.stepdelta = 1; scroll.jumpdelta = pageSize; scroll.value = 0; scroll.enabled = pairs.length > pageSize;
        for (i = 0; i < pageSize; i++) {
            var line = group(rows); line.spacing = 8; line.alignment = ["fill", "top"]; line.minimumSize.height = 27; line.maximumSize.height = 27;
            var tick = line.add("checkbox", undefined, ""); tick.preferredSize.width = 28;
            var firstDivider = separator(line), fresh = line.add("statictext", undefined, ""), secondDivider = separator(line), existing = line.add("statictext", undefined, "");
            firstDivider.preferredSize = secondDivider.preferredSize = [1, 27]; firstDivider.maximumSize.width = secondDivider.maximumSize.width = 1;
            var rule = separator(rows); rule.preferredSize.height = rule.minimumSize.height = rule.maximumSize.height = 1;
            gridRow(line, tick, fresh, existing, i);
            slots.push({ line: line, tick: tick, fresh: fresh, existing: existing, firstDivider: firstDivider, secondDivider: secondDivider, rule: rule, pairIndex: -1 });
        }
        table.preferredSize = [740, 242]; table.minimumSize.height = 242;
        var selectionCount = w.add("statictext", undefined, "");
        var details = section(w, "Replacement details - click a name to inspect the full paths");
        var paths = details.add("edittext", undefined, "", { readonly: true, multiline: true, scrolling: true });
        paths.preferredSize = [720, 150]; paths.minimumSize.height = 130; paths.alignment = ["fill", "fill"];
        function showDetails(index) {
            if (index < 0) { return; } var p = pairs[index];
            paths.text = "NEW RENDER\n" + p.asset.firstPath + "\n\nREPLACES PROJECT CLIP\n" + p.target.folder + "/" + p.target.filename + (p.ambiguous ? "\n\nMultiple possible matches: check only the pairing you want." : "");
        }
        var r = group(w); r.alignment = ["fill", "top"]; r.alignChildren = ["fill", "center"]; r.spacing = 10;
        var confirmButton = button(r, "Confirm replacements", function () {
            var approved = []; for (var j = 0; j < pairs.length; j++) { if (pairs[j].approved) { approved.push(pairs[j]); } } validatePairs(approved, project);
            state.review = approved; state.reviewProject = project; ui.status.text = approved.length + " replacements confirmed. Click Replace project clips to apply."; w.close(1);
        }); confirmButton.primary = true; actionSize(confirmButton, 36);
        var cancelButton = r.add("button", undefined, "Cancel", { name: "cancel" }); actionSize(cancelButton, 36);
        function drawRows() {
            var start = Math.max(0, Math.min(Math.round(scroll.value), Math.max(0, pairs.length - pageSize))), checked = 0;
            for (var k = 0; k < pairs.length; k++) { if (pairs[k].approved) { checked++; } }
            for (var j = 0; j < slots.length; j++) {
                var slot = slots[j], index = start + j, exists = index < pairs.length; slot.pairIndex = exists ? index : -1;
                slot.line.visible = slot.rule.visible = exists;
                slot.tick.visible = slot.fresh.visible = slot.existing.visible = exists;
                if (exists) { var p = pairs[index]; slot.tick.value = !!p.approved; slot.fresh.text = p.asset.displayName; slot.existing.text = p.target.name; slot.fresh.helpTip = p.asset.firstPath; slot.existing.helpTip = p.target.folder + "/" + p.target.filename; slot.tick.helpTip = "Include this replacement"; }
            }
            selectionCount.text = checked + " checked / " + pairs.length + " possible replacements. Ambiguous matches start unchecked.";
            confirmButton.enabled = checked > 0;
        }
        function bindSlot(slot) {
            slot.tick.onClick = function () { if (slot.pairIndex < 0) { return; } pairs[slot.pairIndex].approved = !!this.value; showDetails(slot.pairIndex); drawRows(); };
            slot.fresh.addEventListener("mousedown", function () { showDetails(slot.pairIndex); });
            slot.existing.addEventListener("mousedown", function () { showDetails(slot.pairIndex); });
        }
        for (i = 0; i < slots.length; i++) { bindSlot(slots[i]); }
        scroll.onChanging = scroll.onChange = drawRows;
        function columns() {
            var rowWidth = rows.size.width - 16, width = Math.max(100, Math.floor((rowWidth - 60) / 2));
            newHeader.preferredSize.width = oldHeader.preferredSize.width = width;
            for (var j = 0; j < slots.length; j++) {
                var slot = slots[j]; slot.line.location = [8, 8 + j * 28]; slot.line.size = [rowWidth, 27];
                slot.tick.location = [0, 0]; slot.tick.size = [28, 27];
                slot.firstDivider.location = [34, 0]; slot.firstDivider.size = [1, 27];
                slot.fresh.location = [43, 0]; slot.fresh.size = [width, 27];
                slot.secondDivider.location = [47 + width, 0]; slot.secondDivider.size = [1, 27];
                slot.existing.location = [56 + width, 0]; slot.existing.size = [width, 27];
                slot.rule.location = [8, 35 + j * 28]; slot.rule.size = [rowWidth, 1];
            }
            header.layout.layout(true);
            var half = Math.floor((r.size.width - r.spacing) / 2);
            if (half > 0) { confirmButton.location = [0, 0]; confirmButton.size = [half, 36]; cancelButton.location = [half + r.spacing, 0]; cancelButton.size = [half, 36]; }
        }
        // Give the layout manager usable column widths before the first window layout.
        newHeader.preferredSize.width = oldHeader.preferredSize.width = 330;
        for (i = 0; i < slots.length; i++) { slots[i].fresh.preferredSize.width = slots[i].existing.preferredSize.width = 330; }
        w.onResizing = w.onResize = function () { this.layout.resize(); columns(); };
        w.onShow = columns; drawRows(); showDetails(0); theme(w);
        var result = { window: w, slots: slots, pairs: pairs, rows: rows, scroll: scroll, confirm: confirmButton };
        if (show === false) { w.layout.layout(true); columns(); return result; }
        w.show(); counts(ui); return result;
    }
    function options(ui) {
        var a = ui.alpha.selection.text, alpha = a === "Ignore" ? 1 : a === "Straight" ? 2 : a === "Premultiplied" ? 3 : 0;
        var color = alpha === 3 ? trim(ui.matte.text).replace(/^#/, "") : "000000"; if (!/^[0-9a-f]{6}$/i.test(color)) { throw new Error("Premultiplied matte color must be six hexadecimal digits, e.g. 000000."); }
        return { fps: num(ui.fps.text, "FPS", 1, 99, false), alpha: alpha, matte: [parseInt(color.substr(0, 2), 16) / 255, parseInt(color.substr(2, 2), 16) / 255, parseInt(color.substr(4, 2), 16) / 255], hierarchy: ui.hierarchy.value, fit: ui.fit.selection.text === "Fit (keep aspect)" };
    }
    function persist(ui) {
        save("mode05", ui.mode.selection.text); save("root", ui.root.text); save("allowed", ui.allowed.text);
        save("folderMode", ui.folderMode.selection.text === "Include names" ? 1 : ui.folderMode.selection.text === "Exclude names" ? 2 : 0);
        save("folderWords", ui.folderWords.text); save("sensitive", ui.sensitive.value ? "1" : "0");
        save("ageMode", ui.ageMode.selection.text === "Newer than" ? 1 : ui.ageMode.selection.text === "Older than" ? 2 : 0); save("ageDays", ui.ageDays.text);
        save("fps", ui.fps.text); save("alpha05", ui.alpha.selection.text); save("matte05", ui.matte.text); save("fit05", ui.fit.selection.text); save("hierarchy", ui.hierarchy.value ? "1" : "0");
        save("filtersVisible05", ui.filters.visible ? "1" : "0"); save("showType05", ui.extension.selection ? ui.extension.selection.text : "All");
        save("sequenceOnly060", ui.sequenceOnly.value ? "1" : "0");
    }
    function buildUI(host) {
        state.scanReady = false;
        var w = typeof Panel !== "undefined" && host instanceof Panel ? host : new Window("palette", PANEL_TITLE, undefined, { resizeable: true }), ui = { window: w };
        w.orientation = "column"; w.alignChildren = ["fill", "top"]; w.spacing = 6; w.margins = 10; w.minimumSize = [580, 620];
        ui.heading = w.add("statictext", undefined, PANEL_TITLE);
        ui.heading.preferredSize.height = 18; ui.heading.minimumSize.height = 18; ui.heading.maximumSize.height = 18;
        ui.heading.helpTip = "Too busy? Get BISI!";
        var p = section(w, "1. Project color"), r = group(p); r.alignment = ["fill", "top"];
        var colorPanel = p;
        button(r, "Default AE (sRGB)", function () { applyProjectPreset("srgb"); refreshProjectColor(); ui.status.text = "Adobe color management / sRGB / 32 bpc. Input unchanged."; });
        button(r, "ACES (Redshift)", function () { applyProjectPreset("aces"); refreshProjectColor(); acesGuide(); refreshProjectColor(); ui.status.text = "ACES engine/config/depth applied. Check Working and Display using the guide."; });
        button(r, "Project Settings...", function () { openProjectSettings(); refreshProjectColor(); });
        var colorSpacer = r.add("group"); colorSpacer.alignment = ["fill", "center"]; colorSpacer.minimumSize.width = 20;
        ui.srgb = button(r, "Match sRGB in ACES...", function () { refreshProjectColor(); if (ui.srgb.enabled) { srgbDialog(ui); } }); ui.srgb.alignment = ["right", "center"];
        ui.projectColor = p.add("statictext", undefined, projectColorDescription());
        function refreshProjectColor() {
            ui.projectColor.text = projectColorDescription();
            var enabled = false; try { srgbContext(); enabled = true; } catch (e) {}
            ui.srgb.enabled = enabled;
            ui.srgb.helpTip = enabled ? "Select sRGB layers in the timeline, then match their current input setting." : "Available with OCIO / ACES 1.3 CG v1.0 / ACEScg / 32 bpc. Not needed for Default AE.";
        }
        refreshProjectColor(); w.onActivate = refreshProjectColor;
        w.addEventListener("mouseover", refreshProjectColor);
        p = section(w, "2. Choose folder and scan renders"); r = group(p); r.spacing = 8;
        var sourcePanel = p;
        // Always start in Import; all other user preferences remain persistent.
        ui.mode = { items: [{ text: "Import" }, { text: "Replace" }] }; ui.mode.selection = ui.mode.items[0];
        ui.modeImport = button(r, "Import", function () { ui.mode.selection = ui.mode.items[0]; modeLayout(); });
        ui.modeReplace = button(r, "Replace", function () { ui.mode.selection = ui.mode.items[1]; modeLayout(); });
        actionSize(ui.modeImport, 32); actionSize(ui.modeReplace, 32); ui.modeImport.preferredSize.width = ui.modeReplace.preferredSize.width = 130;
        r = group(p); r.alignment = ["fill", "top"]; ui.root = field(r, "Path", pref("root", ""), 24); ui.root.alignment = ["fill", "center"]; ui.root.minimumSize.width = 100;
        ui.browse = button(r, "Browse...", function () { if (state.scanning) { return; } var folder = chooseRenderRoot(ui.root.text); if (folder) { ui.root.text = folder.fsName; persist(ui); requireScan(ui); } });
        r = group(p); r.alignment = ["fill", "top"]; r.add("statictext", undefined, "Recent"); ui.history = drop(r, [], 0); ui.history.alignment = ["fill", "center"]; ui.history.preferredSize.width = 270; ui.history.minimumSize.width = 100;
        for (var i = 0; i < 8; i++) { var previous = pref("recent" + i, ""); if (previous) { ui.history.add("item", previous); } }
        ui.history.onChange = function () { if (!state.scanning && !ui.updatingHistory && ui.history.selection) { ui.root.text = ui.history.selection.text; persist(ui); requireScan(ui); } };
        ui.filters = section(p, "Scan filters"); ui.allowed = field(group(ui.filters), "Extensions", pref("allowed", DEFAULTS), 48);
        ui.sequenceOnly = ui.filters.add("checkbox", undefined, "Image sequences only"); ui.sequenceOnly.value = pref("sequenceOnly060", "1") === "1";
        ui.sequenceOnly.helpTip = "Only numbered image sequences with two or more frames. Uncheck to include still images, video and other allowed files.";
        // Migrate only the previous stock mega-list; retain custom extension lists.
        if (ui.allowed.text === IMAGES.join(",") + ",mov,mp4,mxf,avi,m4v,mpg,mpeg,wav,aif,aiff,mp3") { ui.allowed.text = DEFAULTS; save("allowed", DEFAULTS); }
        r = group(ui.filters); ui.folderMode = drop(r, ["All folders", "Include names", "Exclude names"], Number(pref("folderMode", "0"))); ui.folderWords = field(r, "Names", pref("folderWords", ""), 24); ui.sensitive = r.add("checkbox", undefined, "Case sensitive"); ui.sensitive.value = pref("sensitive", "0") === "1";
        r = group(ui.filters); ui.ageMode = drop(r, ["Any age", "Newer than", "Older than"], Number(pref("ageMode", "0"))); ui.ageDays = field(r, "Days", pref("ageDays", "1"), 7);
        hide(ui.filters, pref("filtersVisible05", "0") !== "1");
        r = group(p); r.alignment = ["fill", "top"];
        ui.scan = button(r, "Scan", function () { persist(ui); scan(ui); }); ui.scan.primary = true; actionSize(ui.scan, 40); ui.scan.alignment = ["left", "center"]; ui.scan.preferredSize.width = 220;
        ui.scan.helpTip = "Scan the selected path to enable steps 3-5.";
        ui.cancel = button(r, "Cancel scan", function () { if (state.job) { state.job.cancelled = true; } }); ui.cancel.enabled = false;
        ui.filterButton = button(r, "Scan filters", function () { hide(ui.filters, ui.filters.visible); persist(ui); w.layout.layout(true); w.layout.resize(); resizeBrowsers(); });
        var browsers = group(w); ui.browsers = browsers; browsers.alignment = ["fill", "fill"]; browsers.alignChildren = ["fill", "fill"]; browsers.margins = 0;
        ui.left = section(browsers, "3. Select new renders"); ui.left.alignment = ["fill", "fill"];
        r = group(ui.left); r.spacing = 6;
        var selectEvery = button(r, "Select all", function () { selectAll(ui.files, true); refreshCandidates(ui); }); selectEvery.preferredSize.width = 70;
        var selectNone = button(r, "Select none", function () { selectAll(ui.files, false); refreshCandidates(ui); }); selectNone.preferredSize.width = 76;
        ui.extension = drop(r, ["All"], 0);
        ui.extension.preferredSize.width = ui.extension.minimumSize.width = 96; ui.extension.helpTip = "Show all files or filter by file extension.";
        ui.files = ui.left.add("listbox", undefined, [], { multiselect: true, numberOfColumns: 4, showHeaders: true, columnTitles: ["New file / sequence", "Frames", "Folder", "Type"], columnWidths: [260, 55, 180, 85] });
        ui.files.preferredSize = [280, 200]; ui.files.minimumSize = [200, 100]; ui.files.alignment = ["fill", "fill"];
        ui.count = ui.left.add("statictext", undefined, "0 selected");
        ui.right = section(browsers, "4. Matching existing project clips"); ui.right.alignment = ["fill", "fill"];
        var matchHint = ui.right.add("statictext", undefined, "Matches update with your selection.", { multiline: true }); matchHint.preferredSize.height = 28; matchHint.minimumSize.height = 28;
        ui.targets = ui.right.add("listbox", undefined, [], { multiselect: true, numberOfColumns: 2, showHeaders: true, columnTitles: ["Existing project clip", "Current folder"], columnWidths: [220, 180] }); ui.targets.preferredSize = [260, 200]; ui.targets.minimumSize = [200, 100]; ui.targets.alignment = ["fill", "fill"];
        ui.targetCount = ui.right.add("statictext", undefined, "Select new renders on the left.");
        ui.compare = button(w, "Compare and confirm...", function () { review(ui); }); actionSize(ui.compare, 36); ui.compare.alignment = ["fill", "top"];
        ui.importSettings = section(w, "4. Apply to every selected imported clip"); r = group(ui.importSettings);
        ui.settingsFPSRow = r;
        ui.fps = field(r, "FPS", pref("fps", "25"), 6); r.add("statictext", undefined, "Alpha");
        var alphaLabels = ["Automatic / unchanged", "Ignore", "Straight", "Premultiplied"], ai = 0; for (i = 0; i < alphaLabels.length; i++) { if (alphaLabels[i] === pref("alpha05", "")) { ai = i; } } ui.alpha = drop(r, alphaLabels, ai);
        ui.alpha.alignment = ["fill", "center"];
        ui.alpha.helpTip = "Applies to every selected import. AE 26.5 can reject scripted Ignore; that is reported, with previous interpretation retained. Straight and Premultiplied are native-tested.";
        ui.matteGroup = group(ui.importSettings); ui.matte = field(ui.matteGroup, "Premultiplied matte #", pref("matte05", "000000"), 8);
        button(ui.matteGroup, "Choose color", function () { var color = $.colorPicker(); if (color >= 0) { var hex = color.toString(16); while (hex.length < 6) { hex = "0" + hex; } ui.matte.text = hex.toUpperCase(); persist(ui); } });
        r = group(ui.importSettings); ui.hierarchy = r.add("checkbox", undefined, "Keep folder hierarchy"); ui.hierarchy.value = pref("hierarchy", "1") === "1";
        ui.settingsFitRow = r;
        r.add("statictext", undefined, "In composition"); ui.fit = drop(r, ["Fit (keep aspect)", "Original size (keep aspect)"], pref("fit05", "Fit (keep aspect)") === "Original size (keep aspect)" ? 1 : 0);
        ui.fit.alignment = ["fill", "center"];
        ui.actions = section(w, "5. Import selected renders"); ui.actions.alignment = ["fill", "top"];
        // Both modes share one fixed-height slot; a hidden row must not reserve a second row.
        ui.actions.orientation = "stack"; ui.actions.spacing = 0; ui.actions.margins = [10, 10, 10, 10];
        ui.actions.preferredSize.height = 76; ui.actions.minimumSize.height = 76; ui.actions.maximumSize.height = 76;
        ui.importActions = group(ui.actions); r = ui.importActions; r.alignment = ["fill", "top"]; r.alignChildren = ["fill", "center"];
        r.preferredSize.height = 44; r.minimumSize.height = 44; r.maximumSize.height = 44;
        ui.importAction = button(r, "Import", function () { if (!state.scanReady || state.scanning) { return; } var opts = options(ui); persist(ui); report(importBatch(selected(ui.files), opts, false), "imported", ui); }); ui.importAction.primary = true;
        ui.compAction = button(r, "Import to new composition", function () { if (!state.scanReady || state.scanning) { return; } var opts = options(ui); persist(ui); report(importBatch(selected(ui.files), opts, true), "imported", ui); }); ui.compAction.primary = true;
        actionSize(ui.importAction, 44); actionSize(ui.compAction, 44);
        ui.replaceActions = group(ui.actions); r = ui.replaceActions; r.alignment = ["fill", "top"]; r.alignChildren = ["fill", "center"];
        r.preferredSize.height = 44; r.minimumSize.height = 44; r.maximumSize.height = 44;
        ui.replace = button(r, "Replace project clips", function () { var result = replaceBatch(state.review, state.reviewProject); invalidate(ui); refreshCandidates(ui); report(result, "replaced", ui); }); ui.replace.primary = true;
        actionSize(ui.replace, 44);
        ui.replace.helpTip = "Enabled only after you review and confirm the replacements in step 4.";
        ui.status = w.add("statictext", undefined, "Choose a path, then click Scan.");
        ui.status.preferredSize.height = 18; ui.status.minimumSize.height = 18; ui.status.maximumSize.height = 18;
        var mainSections = [{ control: ui.heading, role: "heading" }, { control: colorPanel }, { control: sourcePanel }, { control: browsers, role: "browsers" }, { control: ui.compare, role: "compare" }, { control: ui.importSettings, role: "importSettings" }, { control: ui.actions, role: "actions" }, { control: ui.status, role: "status" }];
        function packPanel() {
            // Hidden sections do not reserve gaps. All spare height belongs to the file lists,
            // keeping the final action and status just above the panel's bottom margin.
            function dim(value, axis) { return Number(value[axis === 0 ? "width" : "height"] !== undefined ? value[axis === 0 ? "width" : "height"] : value[axis]); }
            var width = dim(w.size, 0), height = dim(w.size, 1), visible = [], fixed = 0, i, child, h;
            if (!(width >= 580 && height >= 620)) { return; }
            for (i = 0; i < mainSections.length; i++) {
                child = mainSections[i].control; if (!child.visible) { continue; }
                var role = mainSections[i].role;
                if (role === "browsers") { h = 0; }
                else if (role === "actions") { h = 76; }
                else if (role === "status" || role === "heading") { h = 18; }
                else if (role === "importSettings") { h = ui.alpha.selection.text === "Premultiplied" ? 140 : 104; }
                else { h = dim(child.size, 1); }
                if (!(h >= 0)) { return; } visible.push({ control: child, role: role, height: Number(h) }); fixed += Number(h);
            }
            var minimumHeight = Math.max(620, 20 + fixed + (visible.length - 1) * 6 + 220);
            w.minimumSize.height = minimumHeight;
            if (w instanceof Window && dim(w.size, 1) < minimumHeight) { w.size = [width, minimumHeight]; }
            // ScriptUI may clamp a palette to its native minimum when constraints change.
            // Position the footer against the resulting size, not the requested size.
            height = dim(w.size, 1); width = dim(w.size, 0);
            var viewportHeight = height - 20 - fixed - (visible.length - 1) * 6;
            var y = 10;
            for (i = 0; i < visible.length; i++) {
                child = visible[i].control; h = visible[i].role === "browsers" ? Math.max(0, viewportHeight) : Number(visible[i].height);
                child.location = [10, y]; child.size = [width - 20, h]; if (child.layout) { child.layout.resize(); } y += h + 6;
            }
            if (ui.importSettings.visible) {
                var settingsRows = [ui.settingsFPSRow]; if (ui.alpha.selection.text === "Premultiplied") { settingsRows.push(ui.matteGroup); } settingsRows.push(ui.settingsFitRow);
                for (i = 0; i < settingsRows.length; i++) { child = settingsRows[i]; child.location = [10, 22 + i * 36]; child.size = [width - 40, 30]; child.layout.resize(); }
            }
        }
        function resizeActions() {
            var row = isReplace(ui) ? ui.replaceActions : ui.importActions, rowWidth = (ui.actions.size.width !== undefined ? ui.actions.size.width : ui.actions.size[0]) - 20;
            if (rowWidth <= 0) { return; }
            row.location = [10, 10]; row.size = [rowWidth, 44];
            if (isReplace(ui)) {
                ui.replace.location = [0, 0]; ui.replace.size = [rowWidth, 44];
            } else {
                var half = Math.floor((rowWidth - ui.importActions.spacing) / 2);
                if (half > 0) { ui.importAction.location = [0, 0]; ui.importAction.size = [half, 44]; ui.compAction.location = [half + ui.importActions.spacing, 0]; ui.compAction.size = [rowWidth - half - ui.importActions.spacing, 44]; }
            }
        }
        var resizingPanel = false;
        function resizeBrowsers() {
            if (resizingPanel) { return; } resizingPanel = true;
            try {
            packPanel();
            resizeActions();
            var width = browsers.size.width !== undefined ? browsers.size.width : browsers.size[0], height = browsers.size.height !== undefined ? browsers.size.height : browsers.size[1]; if (!width || !height) { return; }
            var leftWidth = isReplace(ui) ? Math.floor((width - browsers.spacing) / 2) : width;
            ui.left.location = [0, 0]; ui.left.size = [leftWidth, height]; ui.left.layout.resize();
            if (isReplace(ui)) { ui.right.location = [leftWidth + browsers.spacing, 0]; ui.right.size = [width - leftWidth - browsers.spacing, height]; ui.right.layout.resize(); }
            } finally { resizingPanel = false; }
        }
        function modeLayout() {
            refreshProjectColor(); invalidate(ui); var replacement = isReplace(ui); hide(ui.right, !replacement, 270); hide(ui.importSettings, replacement); hide(ui.compare, !replacement); hide(ui.importActions, replacement); hide(ui.replaceActions, !replacement);
            ui.modeImport.primary = !replacement; ui.modeReplace.primary = replacement;
            ui.modeImport.text = "Import"; ui.modeReplace.text = "Replace";
            ui.importAction.visible = ui.compAction.visible = !replacement; ui.replace.visible = replacement;
            ui.left.text = replacement ? "3. New renders (select first)" : "3. Select renders to import"; ui.actions.text = replacement ? "5. Apply confirmed replacements" : "5. Import selected renders"; refreshCandidates(ui); persist(ui); w.layout.layout(true); w.layout.resize(); resizeBrowsers();
        }
        ui.mode.onChange = modeLayout;
        ui.files.onChange = function () { refreshCandidates(ui); };
        ui.targets.onChange = function () { invalidate(ui); counts(ui); };
        ui.extension.onChange = function () { showAssets(ui, true); persist(ui); };
        ui.alpha.onChange = function () { hide(ui.matteGroup, ui.alpha.selection.text !== "Premultiplied"); persist(ui); w.layout.layout(true); w.layout.resize(); resizeBrowsers(); };
        var controls = [ui.root, ui.allowed, ui.folderMode, ui.folderWords, ui.sensitive, ui.ageMode, ui.ageDays, ui.fps, ui.matte, ui.hierarchy, ui.fit];
        for (i = 0; i < controls.length; i++) { controls[i].onChange = function () { persist(ui); invalidate(ui); counts(ui); }; if (controls[i].type === "checkbox") { controls[i].onClick = controls[i].onChange; } }
        ui.root.onChanging = function () { if (!state.scanning) { requireScan(ui); } };
        ui.root.onChange = function () { persist(ui); requireScan(ui); };
        var scanControls = [ui.allowed, ui.folderMode, ui.folderWords, ui.sensitive, ui.ageMode, ui.ageDays, ui.sequenceOnly];
        for (i = 0; i < scanControls.length; i++) { scanControls[i].onChange = function () { persist(ui); requireScan(ui); }; if (scanControls[i].type === "checkbox") { scanControls[i].onClick = scanControls[i].onChange; } }
        hide(ui.matteGroup, ui.alpha.selection.text !== "Premultiplied"); modeLayout(); theme(w); w.layout.layout(true);
        w.onShow = resizeBrowsers;
        w.onResizing = function () { resizeBrowsers(); };
        w.onResize = function () { resizeBrowsers(); if (this instanceof Window) { save("paletteWidth05", this.size.width); save("paletteHeight05", this.size.height); } };
        if (w instanceof Window) {
            var savedWidth = Number(pref("paletteWidth05", "640")), savedHeight = Number(pref("paletteHeight05", "730"));
            // One-time compact default; subsequent user resizing remains persistent.
            if (pref("compact058", "0") !== "1") { savedWidth = Math.min(640, savedWidth); savedHeight = Math.min(730, savedHeight); save("compact058", "1"); }
            w.size = [Math.max(580, savedWidth), Math.max(620, savedHeight)]; w.onResize();
        }
        resizeBrowsers();
        w.onClose = function () { persist(ui); if (state.job) { state.job.cancelled = true; } };
        return ui;
    }
    if ($.global.AOVShuttleTestMode) { $.global.AOVShuttleTestAPI = { state: state, groupFiles: groupFiles, parts: parts, matchName: matchName, naturalCompare: naturalCompare, findCandidates: findCandidates, validatePairs: validatePairs, applyAlpha: applyAlpha, importOne: importOne, importBatch: importBatch, compositionPlan: compositionPlan, makeComposition: makeComposition, resolutions: resolutions, replaceBatch: replaceBatch, applyProjectPreset: applyProjectPreset, acesGuide: acesGuide, chooseRenderRoot: chooseRenderRoot, buildUI: buildUI, scan: scan, persist: persist, isCryptoSequence: isCryptoSequence, addCryptomatte: addCryptomatte, setOCIOChoice: setOCIOChoice, srgbLayerReason: srgbLayerReason, applySRGBLayers: applySRGBLayers, review: review }; return; }
    var ui = buildUI(host); if (ui.window instanceof Window) { ui.window.center(); ui.window.show(); }

}(this));
