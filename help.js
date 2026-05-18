/* ローカル確認時は file:// では fetch が失敗することがあるため、VSCode Live Server 等の簡易サーバー利用を想定します。 */
(function () {
  "use strict";

  var state = {
    branchRowsByParent: new Map(),
    branchTitleById: new Map(),
    leafById: new Map(),
    aiHelpByKey: new Map(),
    manualOpenPaths: new Set(),
    searchTerm: "",
    aiHelpConfig: null,
  };

  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    loadData();
  }

  function cacheElements() {
    els.loadingState = document.getElementById("loading-state");
    els.errorState = document.getElementById("error-state");
    els.errorMessage = document.getElementById("error-message");
    els.helpTree = document.getElementById("help-tree");
    els.searchInput = document.getElementById("help-search-input");
    els.searchClear = document.getElementById("help-search-clear");
    els.searchStatus = document.getElementById("search-status");
    els.aiModal = document.getElementById("ai-help-modal");
    els.aiTitle = document.getElementById("ai-help-title");
    els.aiChoiceTitle = document.getElementById("ai-help-choice-title");
    els.aiChoices = document.getElementById("ai-help-choices");
    els.aiFreeTextLabel = document.getElementById("ai-help-free-text-label");
    els.aiFreeText = document.getElementById("ai-help-free-text");
    els.aiClose = document.getElementById("ai-help-close");
    els.aiSearch = document.getElementById("ai-help-search");
  }

  function bindEvents() {
    if (els.searchInput) {
      els.searchInput.addEventListener("input", function (event) {
        state.searchTerm = String(event.target.value || "").trim();
        updateSearchUi();
        renderTree();
      });
    }

    if (els.searchClear) {
      els.searchClear.addEventListener("click", function () {
        if (!els.searchInput) return;
        els.searchInput.value = "";
        state.searchTerm = "";
        updateSearchUi();
        renderTree();
        els.searchInput.focus();
      });
    }

    if (els.aiClose) {
      els.aiClose.addEventListener("click", closeAiHelpModal);
    }

    if (els.aiModal) {
      els.aiModal.addEventListener("click", function (event) {
        if (event.target === els.aiModal) {
          closeAiHelpModal();
        }
      });
    }

    if (els.aiSearch) {
      els.aiSearch.addEventListener("click", onAiHelpSearch);
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && els.aiModal && !els.aiModal.hidden) {
        event.preventDefault();
        closeAiHelpModal();
      }
    });
  }

  function loadData() {
    Promise.all([
      fetchJson("./data/branch.json"),
      fetchJson("./data/leaf.json"),
      fetchJson("./data/ai_help.json"),
    ])
      .then(function (results) {
        buildIndexes(results[0], results[1], results[2]);
        hideLoading();
        updateSearchUi();
        renderTree();
      })
      .catch(function (error) {
        showError(error);
      });
  }

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) {
        throw new Error("読み込みに失敗しました: " + url + " (" + response.status + ")");
      }
      return response.json();
    });
  }

  function buildIndexes(branchRows, leafRows, aiHelpRows) {
    state.branchRowsByParent = new Map();
    state.branchTitleById = new Map();
    state.leafById = new Map();
    state.aiHelpByKey = new Map();
    state.manualOpenPaths = new Set();

    (Array.isArray(branchRows) ? branchRows : []).forEach(function (row, index) {
      var normalized = normalizeBranchRow(row, index);
      if (!normalized.branch_id) return;

      if (normalized.branch_title && !state.branchTitleById.has(normalized.branch_id)) {
        state.branchTitleById.set(normalized.branch_id, normalized.branch_title);
      }

      if (!state.branchRowsByParent.has(normalized.branch_id)) {
        state.branchRowsByParent.set(normalized.branch_id, []);
      }
      state.branchRowsByParent.get(normalized.branch_id).push(normalized);
    });

    state.branchRowsByParent.forEach(function (rows, parentId) {
      state.branchRowsByParent.set(parentId, sortBranchRows(rows));
    });

    (Array.isArray(leafRows) ? leafRows : []).forEach(function (leaf) {
      var leafId = normalizeText(leaf && leaf.leaf_id);
      if (!leafId) return;
      state.leafById.set(leafId, {
        leaf_id: leafId,
        leaf_title: normalizeText(leaf.leaf_title),
        body: String((leaf && leaf.body) || ""),
      });
    });

    (Array.isArray(aiHelpRows) ? aiHelpRows : []).forEach(function (row) {
      var targetType = normalizeText(row && row.target_type).toUpperCase();
      var targetId = normalizeText(row && row.target_id);
      if (!targetType || !targetId) return;
      state.aiHelpByKey.set(targetType + ":" + targetId, {
        target_type: targetType,
        target_id: targetId,
        button_label: normalizeText(row.button_label) || "AIで調べる",
        base_query: normalizeText(row.base_query),
        choice_title: normalizeText(row.choice_title),
        choices: Array.isArray(row.choices) ? row.choices.map(function (item) { return String(item || ""); }) : [],
        free_text_label: normalizeText(row.free_text_label),
        free_text_placeholder: String((row && row.free_text_placeholder) || ""),
        search_template: String((row && row.search_template) || "{base_query} {choice} {free_text}"),
      });
    });
  }

  function normalizeBranchRow(row, index) {
    return {
      _index: index,
      _rowKey: "row-" + index,
      branch_id: normalizeText(row && row.branch_id),
      branch_title: normalizeText(row && row.branch_title),
      child_order: parseChildOrder(row && row.child_order),
      child_type: normalizeText(row && row.child_type).toUpperCase(),
      child_id: normalizeText(row && row.child_id),
      display_title: normalizeText(row && row.display_title),
      body_format: normalizeText(row && row.body_format).toLowerCase(),
    };
  }

  function parseChildOrder(value) {
    if (value === null || value === undefined || value === "") return null;
    var num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function sortBranchRows(rows) {
    return rows.slice().sort(function (left, right) {
      var leftHas = left.child_order !== null;
      var rightHas = right.child_order !== null;
      if (leftHas && rightHas && left.child_order !== right.child_order) {
        return left.child_order - right.child_order;
      }
      if (leftHas !== rightHas) {
        return leftHas ? -1 : 1;
      }
      return left._index - right._index;
    });
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function hideLoading() {
    if (els.loadingState) els.loadingState.hidden = true;
    if (els.errorState) els.errorState.hidden = true;
    if (els.helpTree) els.helpTree.hidden = false;
  }

  function showError(error) {
    if (els.loadingState) els.loadingState.hidden = true;
    if (els.helpTree) els.helpTree.hidden = true;
    if (els.errorState) els.errorState.hidden = false;
    if (els.errorMessage) {
      var message = "データファイルの読み込みに失敗しました。GitHub Pages 上では動作する前提です。";
      if (error && error.message) {
        message += "\n\n詳細: " + error.message;
      }
      message += "\n\nローカル確認時は VSCode Live Server 等をご利用ください。";
      els.errorMessage.textContent = message;
    }
  }

  function updateSearchUi() {
    updateSearchUiWithCount(null);
  }

  function updateSearchUiWithCount(matchCount) {
    var hasTerm = !!state.searchTerm;
    if (els.searchClear) {
      els.searchClear.hidden = !hasTerm;
    }
    if (els.searchStatus) {
      if (!hasTerm) {
        els.searchStatus.textContent = "見出しや本文を検索できます。";
      } else if (typeof matchCount === "number") {
        els.searchStatus.textContent = matchCount > 0
          ? formatCount(matchCount) + "件をハイライト表示しています。"
          : "該当ありません。クリアボタンを押して下さい。";
      } else {
        els.searchStatus.textContent = "検索中です。";
      }
    }
  }

  function renderTree() {
    if (!els.helpTree) return;

    els.helpTree.innerHTML = "";

    var result = renderBranchChildren("ROOT", "ROOT", [], false, new Set(), 1);
    updateSearchUiWithCount(result.matchCount);
    if (!result.hasContent) {
      var emptyNode = document.createElement("div");
      emptyNode.className = "empty-search";
      emptyNode.textContent = state.searchTerm
        ? "該当するヘルプが見つかりませんでした。"
        : "表示できるヘルプ項目がありません。";
      els.helpTree.appendChild(emptyNode);
      return;
    }

    els.helpTree.appendChild(result.fragment);
  }

  function renderBranchChildren(branchId, pathKey, ancestorBranchIds, forceShowAll, searchTrail, depth) {
    var fragment = document.createDocumentFragment();
    var group = document.createElement("div");
    group.className = "tree-group";
    var rows = state.branchRowsByParent.get(branchId) || [];
    var hasContent = false;
    var matchCount = 0;
    var branchAncestors = Array.isArray(ancestorBranchIds) ? ancestorBranchIds : [];
    var nextSearchTrail = searchTrail instanceof Set ? searchTrail : new Set();

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rendered = renderRow(
        row,
        pathKey + ">" + row._rowKey,
        branchAncestors,
        forceShowAll,
        nextSearchTrail,
        depth
      );
      if (!rendered) continue;
      hasContent = true;
      group.appendChild(rendered.node);
      matchCount += rendered.matchCount;
    }

    if (hasContent) {
      fragment.appendChild(group);
    }

    return {
      fragment: fragment,
      hasContent: hasContent,
      matchCount: matchCount,
    };
  }

  function renderRow(row, pathKey, ancestorBranchIds, forceShowAll, searchTrail, depth) {
    if (row.child_type === "LEAF") {
      return renderLeafRow(row, forceShowAll, depth);
    }
    if (row.child_type === "BRANCH") {
      return renderBranchRow(row, pathKey, ancestorBranchIds, forceShowAll, searchTrail, depth);
    }
    return null;
  }

  function renderLeafRow(row, forceShowAll, depth) {
    var leaf = state.leafById.get(row.child_id);
    if (!leaf) return null;

    var query = state.searchTerm;
    var directMatch = forceShowAll || !query || leafMatchesRow(row, leaf, query);
    if (!directMatch) return null;
    var matchCount = query && leafMatchesRow(row, leaf, query) ? 1 : 0;

    var wrapper = document.createElement("article");
    wrapper.className = "leaf-card " + getLayerClassName(depth);

    var leafTitle = leaf.leaf_title || row.display_title;
    if (leafTitle) {
      var titleNode = document.createElement("h3");
      titleNode.className = "leaf-title";
      appendHighlightedText(titleNode, leafTitle, query);
      wrapper.appendChild(titleNode);
    }

    if (
      query &&
      row.display_title &&
      row.display_title !== leafTitle &&
      matchesQuery(row.display_title, query)
    ) {
      var metaTitle = document.createElement("p");
      metaTitle.className = "leaf-meta";
      appendHighlightedText(metaTitle, row.display_title, query);
      wrapper.appendChild(metaTitle);
    }

    if (normalizeText(leaf.body)) {
      var bodyNode = document.createElement("p");
      bodyNode.className = "leaf-body";
      appendBodyContent(bodyNode, leaf.body, query);
      wrapper.appendChild(bodyNode);
    }

    var aiHelp = getAiHelp("LEAF", row.child_id);
    if (aiHelp) {
      wrapper.appendChild(createAiHelpButton(aiHelp));
    }

    return {
      node: wrapper,
      matchCount: matchCount,
    };
  }

  function renderBranchRow(row, pathKey, ancestorBranchIds, forceShowAll, searchTrail, depth) {
    var branchId = row.child_id;
    if (!branchId) return null;

    if (ancestorBranchIds.indexOf(branchId) !== -1) {
      return null;
    }

    var query = state.searchTerm;
    var selfMatch = forceShowAll || !query || branchMatchesRow(row, query);
    var descendants = analyzeBranchDescendants(branchId, ancestorBranchIds.concat(branchId), searchTrail);
    var shouldInclude = forceShowAll || !query || selfMatch || descendants.hasMatch;
    if (!shouldInclude) return null;
    var matchCount = query && branchMatchesRow(row, query) ? 1 : 0;

    var open = query ? true : state.manualOpenPaths.has(pathKey);
    var wrapper = document.createElement("section");
    wrapper.className = "branch-block";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "branch-toggle " + getLayerClassName(depth) + (open ? " is-open" : "");
    button.setAttribute("aria-expanded", open ? "true" : "false");

    var labelWrap = document.createElement("span");
    labelWrap.className = "branch-label";
    var branchLabel = getBranchLabel(row);
    var branchTitle = getBranchTitle(row.child_id);

    var labelPrimary = document.createElement("span");
    labelPrimary.className = "branch-label-primary";
    appendHighlightedText(labelPrimary, branchLabel, query);
    labelWrap.appendChild(labelPrimary);

    if (query && branchTitle && branchTitle !== branchLabel && matchesQuery(branchTitle, query)) {
      var labelMeta = document.createElement("span");
      labelMeta.className = "branch-label-meta";
      appendHighlightedText(labelMeta, branchTitle, query);
      labelWrap.appendChild(labelMeta);
    }

    button.appendChild(labelWrap);

    var icon = document.createElement("span");
    icon.className = "branch-icon";
    icon.textContent = open ? "−" : "+";
    button.appendChild(icon);

    button.addEventListener("click", function () {
      if (state.searchTerm) return;
      if (state.manualOpenPaths.has(pathKey)) {
        state.manualOpenPaths.delete(pathKey);
      } else {
        state.manualOpenPaths.add(pathKey);
      }
      renderTree();
    });

    wrapper.appendChild(button);

    if (!open) {
      return wrapper;
    }

    var childrenResult = renderBranchChildren(
      branchId,
      pathKey,
      ancestorBranchIds.concat(branchId),
      forceShowAll || selfMatch,
      searchTrail,
      depth + 1
    );

    if (childrenResult.hasContent) {
      wrapper.appendChild(childrenResult.fragment);
    }
    matchCount += childrenResult.matchCount;

    var aiHelp = getAiHelp("BRANCH", branchId);
    if (aiHelp) {
      wrapper.appendChild(createAiHelpButton(aiHelp));
    }

    return {
      node: wrapper,
      matchCount: matchCount,
    };
  }

  function analyzeBranchDescendants(branchId, ancestorBranchIds, searchTrail) {
    if (!state.searchTerm) {
      return { hasMatch: true };
    }

    var loopKey = branchId + "|" + ancestorBranchIds.join(">");
    if (searchTrail.has(loopKey)) {
      return { hasMatch: false };
    }

    var nextTrail = new Set(searchTrail);
    nextTrail.add(loopKey);

    var rows = state.branchRowsByParent.get(branchId) || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.child_type === "LEAF") {
        var leaf = state.leafById.get(row.child_id);
        if (leaf && leafMatchesRow(row, leaf, state.searchTerm)) {
          return { hasMatch: true };
        }
      } else if (row.child_type === "BRANCH") {
        if (branchMatchesRow(row, state.searchTerm)) {
          return { hasMatch: true };
        }
        if (ancestorBranchIds.indexOf(row.child_id) === -1) {
          var nested = analyzeBranchDescendants(row.child_id, ancestorBranchIds.concat(row.child_id), nextTrail);
          if (nested.hasMatch) {
            return { hasMatch: true };
          }
        }
      }
    }

    return { hasMatch: false };
  }

  function branchMatchesRow(row, query) {
    return matchesQuery(getBranchLabel(row), query) || matchesQuery(getBranchTitle(row.child_id), query);
  }

  function leafMatchesRow(row, leaf, query) {
    return (
      matchesQuery(row.display_title, query) ||
      matchesQuery(leaf.leaf_title, query) ||
      matchesQuery(leaf.body, query)
    );
  }

  function matchesQuery(text, query) {
    var source = String(text || "").toLocaleLowerCase();
    var keyword = String(query || "").toLocaleLowerCase();
    return !!keyword && source.indexOf(keyword) !== -1;
  }

  function getBranchLabel(row) {
    return row.display_title || getBranchTitle(row.child_id) || row.child_id;
  }

  function getBranchTitle(branchId) {
    return state.branchTitleById.get(branchId) || branchId;
  }

  function getLayerClassName(depth) {
    return "layer-surface-" + getLayerDepth(depth);
  }

  function getLayerDepth(depth) {
    var num = Number(depth);
    if (!Number.isFinite(num) || num < 1) return 1;
    if (num > 6) return 6;
    return Math.floor(num);
  }

  function formatCount(value) {
    var num = Number(value || 0);
    if (!Number.isFinite(num) || num < 0) return "0";
    return String(Math.floor(num));
  }

  function getAiHelp(targetType, targetId) {
    return state.aiHelpByKey.get(String(targetType || "").toUpperCase() + ":" + String(targetId || ""));
  }

  function createAiHelpButton(config) {
    var wrap = document.createElement("div");
    wrap.className = "ai-help-wrap";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "ai-help-button";
    button.textContent = config.button_label || "AIで調べる";
    button.addEventListener("click", function () {
      openAiHelpModal(config);
    });

    wrap.appendChild(button);
    return wrap;
  }

  function appendBodyContent(container, text, query) {
    var lines = String(text || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      appendTextWithLinks(container, lines[i], query);
      if (i < lines.length - 1) {
        container.appendChild(document.createElement("br"));
      }
    }
  }

  function appendTextWithLinks(container, text, query) {
    var source = String(text || "");
    var pattern = /(https?:\/\/[^\s]+)/g;
    var lastIndex = 0;
    var match;

    while ((match = pattern.exec(source)) !== null) {
      if (match.index > lastIndex) {
        appendHighlightedText(container, source.slice(lastIndex, match.index), query);
      }

      var url = match[0];
      var anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      appendHighlightedText(anchor, url, query);
      container.appendChild(anchor);
      lastIndex = match.index + url.length;
    }

    if (lastIndex < source.length) {
      appendHighlightedText(container, source.slice(lastIndex), query);
    }
  }

  function appendHighlightedText(container, text, query) {
    var source = String(text || "");
    var keyword = String(query || "");

    if (!keyword) {
      container.appendChild(document.createTextNode(source));
      return;
    }

    var lowerSource = source.toLocaleLowerCase();
    var lowerKeyword = keyword.toLocaleLowerCase();
    var startIndex = 0;
    var matchIndex;

    while ((matchIndex = lowerSource.indexOf(lowerKeyword, startIndex)) !== -1) {
      if (matchIndex > startIndex) {
        container.appendChild(document.createTextNode(source.slice(startIndex, matchIndex)));
      }

      var mark = document.createElement("mark");
      mark.textContent = source.slice(matchIndex, matchIndex + keyword.length);
      container.appendChild(mark);
      startIndex = matchIndex + keyword.length;
    }

    if (startIndex < source.length) {
      container.appendChild(document.createTextNode(source.slice(startIndex)));
    }
  }

  function openAiHelpModal(config) {
    state.aiHelpConfig = config;
    if (!els.aiModal) return;

    if (els.aiTitle) {
      els.aiTitle.textContent = config.button_label || "AIで調べる";
    }
    if (els.aiChoiceTitle) {
      els.aiChoiceTitle.textContent = config.choice_title || "選択してください";
    }
    if (els.aiFreeTextLabel) {
      els.aiFreeTextLabel.textContent = config.free_text_label || "補足を入力";
    }
    if (els.aiFreeText) {
      els.aiFreeText.value = "";
      els.aiFreeText.placeholder = config.free_text_placeholder || "";
    }
    if (els.aiChoices) {
      els.aiChoices.innerHTML = "";
      for (var i = 0; i < config.choices.length; i++) {
        var label = document.createElement("label");
        label.className = "choice-item";
        var radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "ai-help-choice";
        radio.value = config.choices[i];
        if (i === 0) radio.checked = true;
        var text = document.createElement("span");
        text.textContent = config.choices[i];
        label.appendChild(radio);
        label.appendChild(text);
        els.aiChoices.appendChild(label);
      }
    }

    els.aiModal.hidden = false;
    window.setTimeout(function () {
      if (els.aiSearch) {
        els.aiSearch.focus();
      }
    }, 0);
  }

  function closeAiHelpModal() {
    state.aiHelpConfig = null;
    if (els.aiModal) {
      els.aiModal.hidden = true;
    }
  }

  function onAiHelpSearch() {
    var config = state.aiHelpConfig;
    if (!config) return;

    var choice = getSelectedAiChoice();
    var freeText = els.aiFreeText ? String(els.aiFreeText.value || "").trim() : "";
    var query = buildAiQuery(config, choice, freeText);
    var url = "https://www.google.com/search?q=" + encodeURIComponent(query);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function getSelectedAiChoice() {
    if (!els.aiChoices) return "";
    var checked = els.aiChoices.querySelector('input[name="ai-help-choice"]:checked');
    return checked ? String(checked.value || "") : "";
  }

  function buildAiQuery(config, choice, freeText) {
    var template = config.search_template || "{base_query} {choice} {free_text}";
    var raw = template
      .replace(/\{choice\}/g, choice || "")
      .replace(/\{free_text\}/g, freeText || "")
      .replace(/\{base_query\}/g, config.base_query || "");

    return raw.replace(/\s+/g, " ").trim();
  }
})();
