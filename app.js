//ボタン, 変数, 配列の定義と取得
const pageList = document.querySelector("#page-list");
const pageListScreen = document.querySelector("#page-list-screen");
const createPageButton = document.querySelector("#create-page-button");
const exportJsonButton = document.querySelector("#export-json-button");
const importJsonButton = document.querySelector("#import-json-button");
const importJsonFile = document.querySelector("#import-json-file");

const pageDetailScreen = document.querySelector("#page-detail-screen");
const experimentTitle = document.querySelector("#experiment-title");
const pageTitleStatus = document.querySelector("#page-title-status");
const backToListButton = document.querySelector("#back-to-list-button");
const exportPageJsonButton = document.querySelector("#export-page-json-button");
const exportPageMDButton = document.querySelector("#export-page-MD-button");
const deletePageButton = document.querySelector("#delete-page-button");

const entryList = document.querySelector("#entry-list");
const draftTime = document.querySelector("#draft-time");
const entryBody = document.querySelector("#entry-body");
const addButton = document.querySelector("#add-entry-button");

const entries = [];
const pages = [];

let entryStartedAt = null;
let lastEntryDate = null;
let isSavingPageTitle = false;
let returnToListAfterTitleSave = false;

let database = null;
let currentPage = null;

let editingEntry = null;
let isSavingEntryEdit = false;


//初期状態で追加ボタンを無効化
addButton.disabled = true;


//補助関数群
function formatDateForFileName(date) {//ファイル名用の日付を生成
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function parseBackupDate(value, fieldName) {//JSONファイルの日時をDateに変換
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new Error(`${fieldName}が正しい日時ではありません。`);
    }

    return date;
}

function sanitizeFileName(fileName) {//ファイル名に使えない文字を置換
    let sanitized = fileName
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim()
        .slice(0, 60)
        .replace(/[. ]+$/g, "");

    if (sanitized === "") {
        sanitized = "無題のページ";
    }

    return sanitized;
}

function formatDateTimeLocalValue(date) {//日付をYYYY-MM-DDTHH:MM形式に変換
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function isSameMinute(dateA, dateB) {//編集前後の時刻が分単位で同じか判定
    return (
        dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate() &&
        dateA.getHours() === dateB.getHours() &&
        dateA.getMinutes() === dateB.getMinutes()
    );
}


//ホーム画面
createPageButton.addEventListener("click", handleCreatePageClick);//新規ページの作成
function handleCreatePageClick() {
    if (database === null || createPageButton.disabled || pageListScreen.hidden) {
        return;
    }

    const page = {
        id: crypto.randomUUID(),
        title: "無題のページ",
        createdAt: new Date()
    };

    const transaction = database.transaction("pages", "readwrite");
    transaction.objectStore("pages").add(page);

    createPageButton.disabled = true;

    transaction.addEventListener("complete", function () {
        pages.push(page);
        renderPages();

        createPageButton.disabled = false;
        openPages(page);
    });

    transaction.addEventListener("abort", function () {
        createPageButton.disabled = false;

        console.error("ページの保存に失敗しました", transaction.error);
        alert("ページの保存に失敗しました。");
    });
}

exportJsonButton.addEventListener("click", exportJsonBackup);//全体をバックアップ
function exportJsonBackup() {
    if (database === null) {
        alert("データベースが準備できていません。")
        return;
    }

    const backup = {
        formatVersion: 1,
        backupType: "full",
        exportedAt: new Date(),
        pages: pages,
        entries: entries
    };

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], {
        type: "application/json"
    });

    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    const dateText = formatDateForFileName(new Date());

    downloadLink.href = downloadUrl;
    downloadLink.download = `experiment-notebook-backup-${dateText}.json`;

    downloadLink.click();

    URL.revokeObjectURL(downloadUrl);
}

//JSONから復元
importJsonButton.addEventListener("click", function() {
    if (database === null) {
        return;
    }

    importJsonFile.click();
});
importJsonFile.addEventListener("change",handleImportJsonFile);
async function handleImportJsonFile() {//選択したファイルを展開
    const file = importJsonFile.files[0];

    if (file === undefined) {
        return;
    }

    try {
        const jsonText = await file.text();
        const backup = JSON.parse(jsonText);

        if (backup == null || typeof backup !== "object" || Array.isArray(backup)) {
            throw new Error("バックアップ全体がオブジェクトではありません");
        }

        if (backup.backupType === "full"){
            const restoredData = prepareFullBackupData(backup);

            const shouldRestore = confirm(
                "現在のすべてのページと記録を、" +
                "選択したバックアップの内容に置き換えます。\n\n" +
                `ページ数：${restoredData.pages.length}\n` +
                `エントリー数：${restoredData.entries.length}\n\n` +
                "復元を続けますか？"
            );

            if (!shouldRestore) {
                return;
            }

            restoreBackupToDatabase(restoredData);
            return;
        }

        if (backup.backupType === "page") {
            const restoredData =
                preparePageBackupData(backup);

            const shouldImport = confirm(
                "次のページを新しいページとして読み込みます。\n\n" +
                `ページ名：${restoredData.page.title}\n` +
                `エントリー数：${restoredData.entries.length}\n\n` +
                "読み込みを続けますか？"
            );

            if (!shouldImport) {
                return;
            }

            importPageBackupToDatabase(restoredData);
            return;
        }

        throw new Error(
            "バックアップの種類を判別できません。"
        );

        
    } catch (error) {
        console.error("バックアップファイルを読み込めませんでした", error);
        alert("バックアップを読み込めませんでした。\n" + error.message);
    } finally {
        importJsonFile.value = "";
    }
}
function prepareFullBackupData(backup) {//全体のJSONデータを検査・変換
    if (backup === null || typeof backup !== "object" || Array.isArray(backup)) {
        throw new Error("バックアップ全体がオブジェクトではありません。");
    }

    if (backup.formatVersion !== 1) {
        throw new Error("対応していないバックアップ形式です。");
    }

    if (backup.backupType !== "full") {
        throw new Error("全体バックアップではありません");
    }

    if (!Array.isArray(backup.pages)) {
        throw new Error("pagesが配列ではありません。");
    }

    if (!Array.isArray(backup.entries)) {
        throw new Error("entriesが配列ではありません。");
    }

    if (backup.pages.length === 0) {
        throw new Error("ページが1件もありません。");
    }

    const restoredPages = backup.pages.map(function (page) {
        if (typeof page.id !== "string" || typeof page.title !== "string") {
            throw new Error("ページのIDまたはタイトルが不正です。");
        }

        return {
            id: page.id,
            title: page.title,
            createdAt: parseBackupDate(page.createdAt, "ページの作成日時")
        };
    });

    const pageIds = new Set(
        restoredPages.map(function (page) {
            return page.id;
        })
    );

    if (pageIds.size !== restoredPages.length) {
        throw new Error("同じページIDが複数あります。");
    }

    const restoredEntries = backup.entries.map(function (entry) {
        if (typeof entry.id !== "string" || typeof entry.pageId !== "string" || typeof entry.body !== "string") {
            throw new Error(
                "エントリーの基本情報が不正です。"
            );
        }

        if (!pageIds.has(entry.pageId)) {
            throw new Error(
                "存在しないページに属するエントリーがあります。"
            );
        }

        if (!Array.isArray(entry.versions) || entry.versions.length === 0) {
            throw new Error(
                "変更履歴がないエントリーがあります。"
            );
        }

        const restoredVersions = entry.versions.map(function (version) {
            if (typeof version.id !== "string" || typeof version.body !== "string") {
                throw new Error(
                    "変更履歴の内容が不正です。"
                );
            }

            return {
                id: version.id,
                savedAt: parseBackupDate(version.savedAt, "履歴の保存日時"),
                startedAt: parseBackupDate(version.startedAt, "履歴の記録日時"),
                body: version.body
            };
        });

        return {
            id: entry.id,
            pageId: entry.pageId,
            startedAt: parseBackupDate(entry.startedAt, "エントリーの記録日時"),
            updatedAt: parseBackupDate(entry.updatedAt, "エントリーの更新日時"),
            body: entry.body,
            versions: restoredVersions
        };
    });

    const entryIds = new Set(
        restoredEntries.map(function (entry) {
            return entry.id;
        })
    );

    if (entryIds.size !== restoredEntries.length) {
        throw new Error("同じエントリーIDが複数あります。");
    }

    return {
        pages: restoredPages,
        entries: restoredEntries
    };
}
function preparePageBackupData(backup) {//ページのJSONデータを検査・変換
    if (backup === null || typeof backup !== "object" || Array.isArray(backup)) {
        throw new Error("ページバックアップがオブジェクトではありません。");
    }

    if (backup.backupType !== "page") {
        throw new Error("ページバックアップではありません。");
    }

    if (backup.page === null || typeof backup.page !== "object" || Array.isArray(backup.page)) {
        throw new Error("ページ情報がありません。");
    }

    if (!Array.isArray(backup.entries)) {
        throw new Error("entriesが配列ではありません。");
    }

    const fullShapedBackup = {
        formatVersion: backup.formatVersion,
        backupType: "full",
        pages: [backup.page],
        entries: backup.entries
    };

    const checkedData = prepareFullBackupData(fullShapedBackup);

    const sourcePage = checkedData.pages[0];
    const newPageId = crypto.randomUUID();

    const restoredPage = {
        ...sourcePage,
        id: newPageId,
        title: `${sourcePage.title}（復元）`,
        createdAt: new Date()
    };

    const restoredEntries =checkedData.entries.map(function (entry) {
        const restoredVersions =entry.versions.map(function (version) {
            return {
                ...version,
                id: crypto.randomUUID()
            };
        });

        return {
            ...entry,
            id: crypto.randomUUID(),
            pageId: newPageId,
            versions: restoredVersions
        };
    });

    return {
        page: restoredPage,
        entries: restoredEntries
    };
}
function restoreBackupToDatabase(restoredData) {//全体データindexedDBへ格納
    const transaction = database.transaction(["pages", "entries"], "readwrite");

    const pageStore = transaction.objectStore("pages");
    const entryStore = transaction.objectStore("entries");

    pageStore.clear();
    entryStore.clear();

    for (const page of restoredData.pages) {
        pageStore.put(page);
    }

    for (const entry of restoredData.entries) {
        entryStore.put(entry);
    }

    exportJsonButton.disabled = true;
    importJsonButton.disabled = true;
    createPageButton.disabled = true;

    transaction.addEventListener("complete", function () {
        alert(
            "バックアップを復元しました。画面を再読み込みします。"
        );

        location.reload();
    });

    transaction.addEventListener("abort", function () {
        exportJsonButton.disabled = false;
        importJsonButton.disabled = false;
        createPageButton.disabled = false;

        console.error(
            "バックアップの復元に失敗しました",
            transaction.error
        );
        alert(
            "復元に失敗しました。元のデータは変更されていません。"
        );
    });
}
function importPageBackupToDatabase(restoredData) {//ページデータをindexedDBへ格納
    const transaction = database.transaction(["pages", "entries"], "readwrite");

    const pageStore = transaction.objectStore("pages");
    const entryStore = transaction.objectStore("entries");

    pageStore.add(restoredData.page);

    for (const entry of restoredData.entries) {
        entryStore.add(entry);
    }

    exportJsonButton.disabled = true;
    importJsonButton.disabled = true;
    createPageButton.disabled = true;

    transaction.addEventListener("complete", function () {
        pages.push(restoredData.page);

        for (const entry of restoredData.entries) {
            entries.push(entry);
        }

        renderPages();

        exportJsonButton.disabled = false;
        importJsonButton.disabled = false;
        createPageButton.disabled = false;

        alert("ページを読み込みました。");

    });

    transaction.addEventListener("abort", function () {
        exportJsonButton.disabled = false;
        importJsonButton.disabled = false;
        createPageButton.disabled = false;

        console.error("ページの読み込みに失敗しました", transaction.error);

        alert("ページの読み込みに失敗しました。" +
            "元のデータは変更されていません。"
        );
    });
}

//ページ選択
function renderPages() {//ページ一覧の表示
    pages.sort(function (a, b) {
        return a.createdAt.getTime() - b.createdAt.getTime();
    });

    pageList.textContent = "";

    for (const page of pages) {
        const item = document.createElement("li");
        const button = document.createElement("button");

        button.type = "button";
        button.textContent = page.title;

        button.addEventListener("click", function () {
            openPages(page);
        });

        item.append(button);
        pageList.append(item);

    }
}

function openPages(page) {//選択したページのみ表示
    if (database === null || createPageButton.disabled || isSavingPageTitle) {
        return;
    }

    currentPage = page;
    experimentTitle.value = page.title;
    pageTitleStatus.textContent = "";
    renderEntries();

    pageListScreen.hidden = true;
    pageDetailScreen.hidden = false;
    backToListButton.focus();
}


//indexedDBを開く
const databaseRequest = indexedDB.open("experiment-notebook", 2);
databaseRequest.addEventListener("upgradeneeded", function () {
    const database = databaseRequest.result;

    if (!database.objectStoreNames.contains("entries")) {
        database.createObjectStore("entries", { keyPath: "id" });
    }

    if (!database.objectStoreNames.contains("pages")) {
        database.createObjectStore("pages", { keyPath: "id" });
    }

});
databaseRequest.addEventListener("success", function () {
    const openedDatabase = databaseRequest.result;
    const transaction = openedDatabase.transaction(["entries", "pages"], "readwrite");
    const request = transaction.objectStore("entries").getAll();

    const pageStore = transaction.objectStore("pages");
    const pageRequest = pageStore.getAll();

    pageRequest.addEventListener("success", function () {
        if (pageRequest.result.length === 0 && request.result.length > 0) {
            const page = {
                id: crypto.randomUUID(),
                title: "最初のページ",
                createdAt: new Date()
            };

            pageStore.add(page);
            currentPage = page;
        } else {
            currentPage = pageRequest.result[0] ?? null;
        }

        const entryStore = transaction.objectStore("entries");

        for (const entry of request.result) {//旧型式を新型式に変換する処理
            let entryChanged = false;

            if (entry.pageId === undefined && currentPage !== null) {
                entry.pageId = currentPage.id;
                entryChanged = true;
            }

            if (entry.versions === undefined) {
                entry.updatedAt = entry.startedAt;

                const firstVersion = {
                    id: crypto.randomUUID(),
                    savedAt: entry.startedAt,
                    startedAt: entry.startedAt,
                    body: entry.body
                };

                entry.versions = [firstVersion];
                entryChanged = true;
            }

            for (const version of entry.versions) {
                if (version.startedAt === undefined) {
                    version.startedAt = entry.startedAt;
                    entryChanged = true;
                }
            }

            if (entryChanged) {
                entryStore.put(entry);
            }
        }
    });

    transaction.addEventListener("complete", function () {
        entries.length = 0;

        for (const entry of request.result) {
            entries.push(entry);
        }

        pages.length = 0;
        for (const page of pageRequest.result) {
            pages.push(page);
        }

        if (pages.length === 0 && currentPage !== null) {
            pages.push(currentPage);
        }
        renderPages();

        renderEntries();
        database = openedDatabase;
        addButton.disabled = false;
        createPageButton.disabled = false;
        exportJsonButton.disabled = false;
        importJsonButton.disabled = false;
    });

    transaction.addEventListener("abort", function () {
        console.error("エントリーの読み込みに失敗しました", transaction.error);
        alert("エントリーの読み込みに失敗しました。");    
    });

});
databaseRequest.addEventListener("error", function () {
    console.error("保存場所を開けませんでした", databaseRequest.error);
});


//ページ内画面
backToListButton.addEventListener("click", showPageList);//ページ一覧に戻る
function showPageList() {
    if (editingEntry !== null || isSavingEntryEdit) {
        alert("編集中の記録があります。");
        return;
    }

    if (addButton.disabled) {
        return;
    }

    if (entryBody.value !== "") {
        alert("入力途中の記録があります。");
        return;
    }

    savePageTitle();

    if (isSavingPageTitle) {
        returnToListAfterTitleSave = true;
        return;
    }

    entryStartedAt = null;
    draftTime.textContent = "";
    currentPage = null;

    pageListScreen.hidden = false;
    pageDetailScreen.hidden = true;
    
    const firstPageButton = pageList.querySelector("button");

    if (firstPageButton !== null) {
        firstPageButton.focus();
    } else {
        createPageButton.focus();
    }
}

exportPageJsonButton.addEventListener("click", exportPageJsonBackup);//ページのバックアップ
function exportPageJsonBackup() {
    if (editingEntry !== null || isSavingEntryEdit) {
        alert("編集中の記録があります。");
        return;
    }

    if (entryBody.value !== "") {
        alert("入力途中の記録があります。");
        return;
    }

    if (database === null || currentPage === null) {
        alert("データベースが準備できていません。")
        return;
    }

    const pageEntries = entries.filter(function (entry) {
        return entry.pageId === currentPage.id;
    });

    const backup = {
        formatVersion: 1,
        backupType: "page",
        exportedAt: new Date(),
        page: currentPage,
        entries: pageEntries
    };

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], {
        type: "application/json"
    });

    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    const dateText = formatDateForFileName(new Date());

    downloadLink.href = downloadUrl;
    downloadLink.download = `experiment-page-backup-${dateText}.json`;

    downloadLink.click();

    URL.revokeObjectURL(downloadUrl);
}

//MDで書き出す
function createPageMD(pageTitle, pageEntries) {//MDを生成
    const markdownLines = [`# ${pageTitle}`, "" ];

    if (pageEntries.length === 0) {
        markdownLines.push("_記録はありません。_", "");

        return markdownLines.join("\n");
    }

    let previousDate = null;

    for (const entry of pageEntries) {
        const entryDate =formatDateForFileName(entry.startedAt);

        if (entryDate !== previousDate) {
            markdownLines.push(`## ${entryDate}`, "");
            previousDate = entryDate;
        }

        const entryTime =entry.startedAt.toLocaleTimeString("ja-JP",{
            hour: "2-digit",
            minute: "2-digit"
        });

        markdownLines.push(`**${entryTime}**`, "", entry.body, "");
    }

    return markdownLines.join("\n");
}
exportPageMDButton.addEventListener("click", exportPageMD);
function exportPageMD() {//MDファイルを書き出し
    if (database === null || currentPage === null) {
        alert("ページを読み込めていません。");
        return;
    }

    if (editingEntry !== null || isSavingEntryEdit) {
        alert("編集中の記録があります。");
        return;
    }

    if (entryBody.value !== "") {
        alert("入力途中の記録があります。" + "追加してから書き出してください。");
        return;
    }

    let pageTitle = experimentTitle.value.trim();

    if (pageTitle === "") {
        pageTitle = "無題のページ";
    }

    const pageEntries = entries.filter(function (entry) {
        return entry.pageId === currentPage.id;
    });

    pageEntries.sort(function (a, b) {
        return (a.startedAt.getTime() - b.startedAt.getTime());
    });

    const markdown = createPageMD(pageTitle, pageEntries);

    const blob = new Blob([markdown], {
        type: "text/markdown;charset=utf-8"
    });

    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    const dateText = formatDateForFileName(new Date());

    const safeTitle = sanitizeFileName(pageTitle);

    downloadLink.href = downloadUrl;
    downloadLink.download = `${safeTitle}-${dateText}.md`;

    document.body.append(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    setTimeout(function () {URL.revokeObjectURL(downloadUrl);}, 0);
}

deletePageButton.addEventListener("click", handleDeletePageClick);//ページの削除
function handleDeletePageClick() {
    if (editingEntry !== null || isSavingEntryEdit) {
        alert("編集中の記録があります。");
        return;
    }

    if (database === null || currentPage === null || isSavingEntryEdit || editingEntry !== null || addButton.disabled) {
        return;
    }

    if (entryBody.value !== "") {
        alert("入力途中の記録があります。");
        return;
    }

    const pageToDelete = currentPage;

    const entriesToDelete = entries.filter(
        function (entry) {
            return entry.pageId === pageToDelete.id;
        }
    );

    const shouldDelete = confirm(
        `「${pageToDelete.title}」を削除します。\n\n` +
        `このページには${entriesToDelete.length}件の` +
        "エントリーがあります。\n" +
        "変更履歴もすべて削除されます。\n\n" +
        "この操作を続けますか？"
    );

    if (!shouldDelete) {
        return;
    }

    const transaction = database.transaction(["pages", "entries"], "readwrite");

    const pageStore = transaction.objectStore("pages");

    const entryStore = transaction.objectStore("entries");

    pageStore.delete(pageToDelete.id);

    for (const entry of entriesToDelete) {
        entryStore.delete(entry.id);
    }

    deletePageButton.disabled = true;
    backToListButton.disabled = true;
    exportPageJsonButton.disabled = true;
    addButton.disabled = true;
    experimentTitle.readOnly = true;

    transaction.addEventListener("complete", function () {
        const pageIndex = pages.findIndex(
            function (page) {
                return page.id === pageToDelete.id;
            }
        );

        if (pageIndex !== -1) {
            pages.splice(pageIndex, 1);
        }

        for (
            let index = entries.length - 1;
            index >= 0;
            index--
        ) {
            if (
                entries[index].pageId === pageToDelete.id
            ) {
                entries.splice(index, 1);
            }
        }

        currentPage = null;
        entryStartedAt = null;
        draftTime.textContent = "";
        entryBody.value = "";

        renderPages();

        pageDetailScreen.hidden = true;
        pageListScreen.hidden = false;

        deletePageButton.disabled = false;
        backToListButton.disabled = false;
        exportPageJsonButton.disabled = false;
        addButton.disabled = false;
        experimentTitle.readOnly = false;

        createPageButton.focus();
    });

    transaction.addEventListener("abort", function () {
        deletePageButton.disabled = false;
        backToListButton.disabled = false;
        exportPageJsonButton.disabled = false;
        addButton.disabled = false;
        experimentTitle.readOnly = false;

        console.error("ページの削除に失敗しました", transaction.error);
        alert("ページの削除に失敗しました。");
    });
}

//ページタイトルの保存
experimentTitle.addEventListener("blur", savePageTitle);
function savePageTitle() {
    if (
        database === null ||
        currentPage === null ||
        pageDetailScreen.hidden ||
        isSavingPageTitle
    ) {
        return;
    }

    const page = currentPage;
    let title = experimentTitle.value.trim();

    if (title === "") {
        title = "無題のページ";
    }

    if (title === page.title) {
        experimentTitle.value = title;
        pageTitleStatus.textContent = "保存済み";
        return;
    }

    const updatedPage = {
        ...page,
        title: title
    };

    const transaction = database.transaction("pages", "readwrite");
    transaction.objectStore("pages").put(updatedPage);

    isSavingPageTitle = true;
    experimentTitle.readOnly = true;
    pageTitleStatus.textContent = "保存中…";

    transaction.addEventListener("complete", function () {
        page.title = title;
        experimentTitle.value = title;
        renderPages();

        isSavingPageTitle = false;
        experimentTitle.readOnly = false;
        pageTitleStatus.textContent = "保存済み";

        if (returnToListAfterTitleSave) {
            returnToListAfterTitleSave = false;
            showPageList();
        }
    });

    transaction.addEventListener("abort", function () {
        isSavingPageTitle = false;
        experimentTitle.readOnly = false;
        returnToListAfterTitleSave = false;

        pageTitleStatus.textContent = "保存失敗：入力した名前は未保存です";
        console.error("ページ名の保存に失敗しました", transaction.error);
    });
}
experimentTitle.addEventListener("input", function () {
    pageTitleStatus.textContent = "未保存";
});

//エントリーを描画
function renderEntry(entry) {//エントリーを表示
    const entryDate = entry.startedAt.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });

    if (entryDate !== lastEntryDate) {
        const dateHeading = document.createElement("h3");
        dateHeading.textContent = entryDate;
        entryList.append(dateHeading);

        lastEntryDate = entryDate;
    }

    const entryTime = entry.startedAt.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit"
    });

    const newEntry = document.createElement("p");
    const newEntryTime = document.createElement("time");
    const newEntryContent = document.createElement("div");
    const newEntryBody = document.createElement("span");

    newEntryContent.className = "entry-content";
    
    newEntryTime.textContent = entryTime;
    newEntryBody.textContent = entry.body;
    newEntryBody.title = "ダブルクリックまたは長押しで編集";

    newEntryContent.append(newEntryBody);

    if (entry.versions.length > 1) {
        const updateTime = entry.updatedAt.toLocaleTimeString("ja-JP", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });

        const updateNotice = document.createElement("small");
        updateNotice.textContent = `（${updateTime} 更新）`;
        newEntryContent.append(updateNotice);
    }

    attachEntryEditTriggers(entry, newEntryContent, newEntryBody);

    newEntry.append(newEntryTime, newEntryContent);
    entryList.append(newEntry);
}
function renderEntries() {//エントリーを順に表示
    entryList.textContent = "";
    lastEntryDate = null;

    if (currentPage === null) {
        return;
    }

    const pageEntries = entries.filter(function (entry) {
        return entry.pageId === currentPage.id;
    });
    
    pageEntries.sort(function (a, b) {
        return a.startedAt.getTime() - b.startedAt.getTime();
    });

    for (const entry of pageEntries) {
        renderEntry(entry);
    }
}

//記録入力
entryBody.addEventListener("focus", handleEntryFocus);//入力欄にフォーカス
function handleEntryFocus() {
    if (entryStartedAt === null) {
        entryStartedAt = new Date();
        
        draftTime.textContent = entryStartedAt.toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit"
        });
    }
}
entryBody.addEventListener("blur", handleEntryBlur);//入力欄からブラー
function handleEntryBlur() {
    if (entryBody.value === "") {
        entryStartedAt = null;
        draftTime.textContent = "";
    }
}
addButton.addEventListener("click", handleAddButtonClick);//エントリーの追加
function handleAddButtonClick() {
    if (editingEntry !== null || isSavingEntryEdit) {
        alert("編集中の記録があります。");
        return;
    }

    if (database === null || currentPage === null || addButton.disabled || entryBody.value.trim() === "" || entryStartedAt === null) {
        return;
    }

    const versionSavedAt = new Date();
    const firstVersion = {
        id: crypto.randomUUID(),
        savedAt: versionSavedAt,
        startedAt: entryStartedAt,
        body: entryBody.value
    };

    const entry = {
        id: crypto.randomUUID(),
        pageId: currentPage.id,
        startedAt: entryStartedAt,
        updatedAt: versionSavedAt,
        body: entryBody.value,
        versions: [firstVersion]
    };

    const transaction = database.transaction("entries", "readwrite");
    transaction.objectStore("entries").add(entry);

    addButton.disabled = true;
    entryBody.readOnly = true;

    transaction.addEventListener("complete", function () {
        entries.push(entry);
        renderEntries();

        entryBody.value = "";
        entryStartedAt = null;
        draftTime.textContent = "";

        entryBody.readOnly = false;
        addButton.disabled = false;
    });

    transaction.addEventListener("abort", function () {
        entryBody.readOnly = false;
        addButton.disabled = false;

        console.error("エントリーの保存に失敗しました", transaction.error);
        alert("エントリーの保存に失敗しました。");
    });
}

//エントリー編集・削除
function startEditingEntry(entry, entryContent, entryBodyText) {//エントリーを編集開始
    if (database === null || editingEntry !== null || isSavingEntryEdit || addButton.disabled) {
        return;
    }

    if (entryBody.value !== "") {
        alert("入力途中です。")
        return;
    }

    editingEntry = entry;
    entryBodyText.hidden = true;

    const editor = document.createElement("div");
    const editStartedAtLabel = document.createElement("label");
    const editStartedAt = document.createElement("input");
    const editBody = document.createElement("textarea");
    const actions = document.createElement("div");
    const saveButton = document.createElement("button");
    const cancelButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    actions.className = "entry-edit-actions";

    editStartedAtLabel.textContent = "記録日時";
    editStartedAt.type = "datetime-local";
    editStartedAt.step = 60;
    editStartedAt.value = formatDateTimeLocalValue(entry.startedAt);
    editStartedAt.setAttribute("aria-label", "エントリーの日時を編集");

    editBody.rows = 4;
    editBody.value = entry.body;
    editBody.setAttribute("aria-label", "エントリー本文を編集");

    saveButton.type = "button";
    saveButton.textContent = "保存";

    cancelButton.type = "button";
    cancelButton.textContent = "キャンセル";

    deleteButton.type = "button";
    deleteButton.textContent = "削除";
    deleteButton.className = "danger-button";

    actions.append(saveButton, cancelButton, deleteButton);

    const versionHistory = createVersionHistoryList(entry);
    editor.append(editStartedAtLabel, editStartedAt, editBody, actions, versionHistory);

    entryContent.append(editor);

    function closeEditor() {
        editor.remove();
        entryBodyText.hidden = false;
        editingEntry = null;
    }

    cancelButton.addEventListener("click", function () {
        if (isSavingEntryEdit) {
            return;
        }
        closeEditor();
    });

    deleteButton.addEventListener("click", function () {
        if (isSavingEntryEdit) {
            return;
        }
    
        const entryTime = entry.startedAt.toLocaleString("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });

        const shouldDelete = confirm(
            `${entryTime}のエントリーを、` +
            "変更履歴ごと削除します。\n\n" +
            "この操作を続けますか？"
        );

        if (!shouldDelete) {
            return;
        }

        const transaction = database.transaction("entries", "readwrite");

        transaction.objectStore("entries").delete(entry.id);

        isSavingEntryEdit = true;
        editStartedAt.readOnly = true;
        editBody.readOnly = true;
        saveButton.disabled = true;
        cancelButton.disabled = true;
        deleteButton.disabled = true;

        transaction.addEventListener("complete", function () {
            const entryIndex = entries.findIndex(
                function (storedEntry) {
                    return storedEntry.id === entry.id;
                }
            );

            if (entryIndex !== -1) {
                entries.splice(entryIndex, 1);
            }

            editingEntry = null;
            isSavingEntryEdit = false;

            renderEntries();
        });

        transaction.addEventListener("abort", function () {
            isSavingEntryEdit = false;
            editStartedAt.readOnly = false;
            editBody.readOnly = false;
            saveButton.disabled = false;
            cancelButton.disabled = false;
            deleteButton.disabled = false;

            console.error("エントリーの削除に失敗しました",transaction.error);
            alert("エントリーの削除に失敗しました。");
        });
    });

    saveButton.addEventListener("click", function () {
        if (isSavingEntryEdit) {
            return;
        }

        const newBody = editBody.value;

        const inputStartedAt = new Date(editStartedAt.value);
        if (Number.isNaN(inputStartedAt.getTime())) {
            alert("記録日時を入力してください。");
            return;
        }
        const timeChanged = !isSameMinute(inputStartedAt, entry.startedAt);

        const newStartedAt = timeChanged
            ? inputStartedAt
            : entry.startedAt;


        if (newBody.trim() === "") {
            alert("本文を空にすることはできません。");
            return;
        }
        
        const bodyChanged = newBody !== entry.body;
        if (!bodyChanged && !timeChanged) {
            closeEditor();
            return;
        }

        if (timeChanged && newStartedAt.getTime() > Date.now()) {
            const shouldContinue = confirm("未来の日時に変更しますか？");
            if (!shouldContinue) {
                return;
            }
        }

        const savedAt = new Date();

        const newVersion = {
            id: crypto.randomUUID(),
            savedAt: savedAt,
            startedAt: newStartedAt,
            body: newBody
        };

        const updatedVersions = [
            ...entry.versions,
            newVersion
        ];

        const updatedEntry = {
            ...entry,
            startedAt: newStartedAt,
            updatedAt: savedAt,
            body: newBody,
            versions: updatedVersions
        };

        const transaction = database.transaction("entries", "readwrite");
        transaction.objectStore("entries").put(updatedEntry);

        isSavingEntryEdit = true;
        editStartedAt.readOnly = true;
        editBody.readOnly = true;
        saveButton.disabled = true;
        cancelButton.disabled = true;

        transaction.addEventListener("complete", function () {
            entry.startedAt = newStartedAt;
            entry.updatedAt = savedAt;
            entry.body = newBody;
            entry.versions = updatedVersions;

            editingEntry = null;
            isSavingEntryEdit = false;

            renderEntries();
        });

        transaction.addEventListener("abort", function () {
            isSavingEntryEdit = false;
            editStartedAt.readOnly = false;
            editBody.readOnly = false;
            saveButton.disabled = false;
            cancelButton.disabled = false;

            console.error("エントリーの編集に失敗しました", transaction.error);
            alert("エントリーの編集に失敗しました。");
        });
    });

    editBody.focus();
}
function attachEntryEditTriggers(entry, entryContent, entryBodyText) {//編集開始のトリガー
    let longPressTimer = null;

    function beginEditing() {
        if (longPressTimer !==null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        startEditingEntry(entry, entryContent, entryBodyText);
    }

    function cancelLongPress() {
        if (longPressTimer !== null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    entryBodyText.addEventListener("dblclick", beginEditing);

    entryBodyText.addEventListener("pointerdown", function (event) {
        if (event.pointerType === "mouse") {
            return;
        }

        longPressTimer = setTimeout(beginEditing, 600);
    });

    entryBodyText.addEventListener("pointerup", cancelLongPress);
    entryBodyText.addEventListener("pointerleave", cancelLongPress);
    entryBodyText.addEventListener("pointercancel", cancelLongPress);
}
function createVersionHistoryList(entry) {//編集履歴を表示
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const list = document.createElement("ol");

    details.className = "version-history";
    summary.textContent = `変更履歴（全${entry.versions.length}版）`;
    

    let versionNumber = 1;

    for (const version of entry.versions) {
        const item = document.createElement("li");
        const heading = document.createElement("strong");
        const operatingTime = document.createElement("div");
        const body = document.createElement("div");

        const savedAt = version.savedAt.toLocaleString("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });

        const startedAt = version.startedAt.toLocaleString("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });

        let versionLabel;

        if (versionNumber === 1){
            versionLabel = "初版";
        } else {
            versionLabel = `修正${versionNumber-1}`;
        }

        if (versionNumber === entry.versions.length) {
            versionLabel += "（現在）";
        }

        heading.textContent = `${versionLabel}（${savedAt}）`;
        
        operatingTime.className = "version-history-time";
        operatingTime.textContent = `記録日時：${startedAt}`;

        body.className = "version-history-body";
        body.textContent = version.body;

        item.append(heading, operatingTime, body);
        list.append(item);

        versionNumber++;
    }

    details.append(summary, list);

    return details;
}

//service-workerを登録
window.addEventListener("load", function () {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker
            .register("./service-worker.js")
            .then(function () {
                console.log("Service Workerを登録しました。");
            })
            .catch(function (error) {
                console.error("Service Workerの登録に失敗しました。", error);
            });
    }
});