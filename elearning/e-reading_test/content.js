// content.js (「学習する」ボタン起動・最終版)

// ===== メインロジック =====

// 1. 「学習する」ボタンのクリックを監視し、データ取得の「フラグ」を立てる
document.addEventListener('click', async (event) => {
    // クリックされた要素が「学習する」ボタンか確認
    const learningButton = event.target.closest('a.btn.btn_dictan');
    if (learningButton && learningButton.textContent.trim().includes('学習する')) {
        console.log('HELPER: 「学習する」ボタンがクリックされました。データ取得の準備をします。');

        // 既存のセッション情報をクリア
        await chrome.storage.local.remove(['fetchRetryCount', 'questionsData', 'answeredCount']);
        // 次のページでデータを取得すべき、というフラグを保存
        await chrome.storage.local.set({ shouldFetchAnswers: true });
    }

    // モード識別のためにタブのクリックも監視
    const clickedTab = event.target.closest('a.book_navi');
    if (clickedTab) {
        const tabName = clickedTab.textContent.trim().replace(/\s+/g, ' ');
        await chrome.storage.local.set({ lastClickedTab: tabName });
    }
});

// 2. 問題ページ読み込み時に「フラグ」を確認し、データ取得を開始する
(async () => {
    // 問題ページでなければ何もしない
    if (!window.location.href.includes('/as/lplayer/index.cfm')) return;

    const data = await chrome.storage.local.get('shouldFetchAnswers');

    // フラグが立っている場合のみ、データ取得処理を開始
    if (data.shouldFetchAnswers) {
        console.log('HELPER: 問題ページを検出。フラグに基づき解答の自動取得を開始します...');
        // 一度使ったフラグは削除
        await chrome.storage.local.remove('shouldFetchAnswers');
        // データ取得から解答適用までの一連の処理を開始
        await fetchAndThenApply();
    } else {
        // フラグがない場合（「次へ」ボタンで移動してきた場合など）
        console.log('HELPER: 次のページを検出。保存済みの解答を適用します...');
        applyAnswersFromStorage();
    }
})();

// ポップアップからの手動実行命令を監視
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === "apply") {
        applyAnswersFromStorage();
    }
    return true;
});


// ===== 補助関数 =====

// データ取得から始まる一連の処理
async function fetchAndThenApply() {
    const questionsData = await fetchAndParseAllQuestions();
    if (questionsData) {
        await chrome.storage.local.remove('fetchRetryCount');
        waitForElementsAndApply(questionsData, 0);
    }
}

// XMLを解析し、構造化された問題データを作成する関数
async function fetchAndParseAllQuestions() {
    try {
        const auToken = await getAuToken();
        if (!auToken) throw new Error("au_tokenが見つかりません。");
        const xmlUrl = `https://supereigo.campus.kit.ac.jp/as/player_data/authoring.cfc?method=bookXml&au_token=${auToken}&ran=${Date.now()}`;
        const response = await fetch(xmlUrl);
        if (!response.ok) throw new Error(`XMLの取得に失敗: ${response.statusText}`);
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        const questions = Array.from(xmlDoc.querySelectorAll('question'));
        const questionsData = questions.map(q => {
            const type = q.getAttribute('type');
            const questionText = q.querySelector('questionText')?.textContent.trim() || '';
            let answer = null;
            if (type === 'multipleChoice') {
                const answerNo = q.querySelector('answer')?.textContent;
                if (answerNo) {
                    const choice = q.querySelector(`choice[no="${answerNo}"]`);
                    answer = choice ? choice.textContent.trim() : null;
                }
            } else if (type === 'sortingA') {
                const match = questionText.match(/\[(.*?)\]/);
                if (match && match[1]) {
                    answer = match[1].split('/');
                }
            }
            return { type, questionText, answer };
        }).filter(item => item.answer);
        if (questionsData.length === 0) throw new Error("解析可能な問題データがありません。");
        await chrome.storage.local.set({ questionsData: questionsData, answeredCount: 0 });
        console.log('HELPER: 全問題の構造化データを保存しました:', questionsData);
        return questionsData;
    } catch (error) {
        console.error("HELPER (Fetch Error):", error.message);
        await handleFetchError();
        return null;
    }
}

// 保存されたデータから解答適用を開始する関数
async function applyAnswersFromStorage() {
    const data = await chrome.storage.local.get(["questionsData", "answeredCount"]);
    if (!data.questionsData) return;
    waitForElementsAndApply(data.questionsData, data.answeredCount || 0);
}

// ページ上の問題要素が表示されるのを待つ関数
function waitForElementsAndApply(questionsData, startIndex) {
    let attempts = 0;
    const intervalId = setInterval(() => {
        attempts++;
        const questionContainer = document.querySelector('div[class^="MultipleChoiceQuestionBuilder__choices"], ul[class^="SortingAQuestionBuilder__sortStringList"]');
        if (questionContainer) {
            clearInterval(intervalId);
            solveCurrentPage(questionsData, startIndex);
        } else if (attempts >= 15) {
            clearInterval(intervalId);
        }
    }, 1000);
}

// 問題タイプを判別して処理を振り分ける関数
async function solveCurrentPage(questionsData, startIndex) {
    const multipleChoiceContainer = document.querySelector('div[class^="MultipleChoiceQuestionBuilder__choices"]');
    const sortingContainer = document.querySelector('ul[class^="SortingAQuestionBuilder__sortStringList"]');

    let answeredOnThisPage = 0;
    if (multipleChoiceContainer) {
        answeredOnThisPage = await solveMultipleChoice(questionsData, startIndex);
    } else if (sortingContainer) {
        const questionData = questionsData[startIndex];
        if (questionData && questionData.type === 'sortingA') {
            await solveSortingProblem(sortingContainer, questionData.answer);
            answeredOnThisPage = 1;
        }
    }

    if (answeredOnThisPage === 0) {
        console.log("HELPER: このページで解答可能な問題が見つかりませんでした。");
        return;
    }

    const newAnsweredCount = startIndex + answeredOnThisPage;
    await chrome.storage.local.set({ answeredCount: newAnsweredCount });
    console.log(`HELPER: 解答済みカウントを更新しました: ${newAnsweredCount}`);

    if (newAnsweredCount < questionsData.length) {
        clickNextButton();
    } else {
        clickConfirmButton();
    }
}

// 並び替え問題を解く関数
async function solveSortingProblem(sortContainer, orderedWords) {
    const wordElements = Array.from(sortContainer.querySelectorAll('li'));
    const wordMap = new Map(wordElements.map(el => [el.textContent.trim(), el]));
    for (const word of orderedWords) {
        if (wordMap.has(word)) {
            simulateRealClick(wordMap.get(word));
            await delay(400);
        }
    }
    const completeButton = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.trim() === '完了');
    if (completeButton) {
        simulateRealClick(completeButton);
        await delay(1000);
    }
}

// 選択式問題を解く関数
async function solveMultipleChoice(questionsData, startIndex) {
    const answers = questionsData.map(q => q.answer).flat();
    const choiceGroups = document.querySelectorAll('div[class^="MultipleChoiceQuestionBuilder__choices"], ul[class^="MultipleChoiceQuestionBuilder__hBox"]');
    if (choiceGroups.length === 0) return 0;

    let answeredOnThisPage = 0;
    for (const [index, group] of choiceGroups.entries()) {
        const currentAnswerIndex = startIndex + index;
        if (currentAnswerIndex >= answers.length) break;
        const correctAnswerText = answers[currentAnswerIndex];
        const buttonsInGroup = group.querySelectorAll('button');
        for (const button of buttonsInGroup) {
            if (button.textContent.trim() === correctAnswerText) {
                simulateRealClick(button);
                answeredOnThisPage++;
                await delay(300);
                break;
            }
        }
    }
    return answeredOnThisPage;
}


// (以降は変更のないヘルパー関数群)
const delay = ms => new Promise(res => setTimeout(res, ms));

async function handleFetchError() {
    let { fetchRetryCount = 0 } = await chrome.storage.local.get('fetchRetryCount');
    fetchRetryCount++;
    if (fetchRetryCount < 3) {
        await chrome.storage.local.set({ fetchRetryCount: fetchRetryCount, shouldFetchAnswers: true });
        window.location.reload();
    } else {
        await chrome.storage.local.remove(['fetchRetryCount', 'shouldFetchAnswers']);
        alert("クラッシュしました。前のページに戻ります。");
        clickBackButton();
    }
}

function clickBackButton() {
    const backButtonText = "前のページに戻る";
    const clickableElements = document.querySelectorAll('button, a, div[role="button"], span');
    for (const el of clickableElements) {
        if (el.textContent.trim().includes(backButtonText)) {
            el.click(); return;
        }
    }
}

async function clickNextButton() {
    let attempts = 0;
    const intervalId = setInterval(() => {
        attempts++;
        const nextButton = document.querySelector('#nextButton:not([disabled])');
        if (nextButton) {
            clearInterval(intervalId);
            simulateRealClick(nextButton);
        } else if (attempts >= 10) {
            clearInterval(intervalId);
        }
    }, 1000);
}

function clickConfirmButton() {
    let attempts = 0;
    const intervalId = setInterval(() => {
        attempts++;
        const confirmButton = document.querySelector('#confirmButton:not([disabled])');
        if (confirmButton) {
            clearInterval(intervalId);
            simulateRealClick(confirmButton);
        } else if (attempts >= 10) {
            clearInterval(intervalId);
        }
    }, 1000);
}

function simulateRealClick(element) {
    element.style.backgroundColor = 'gold';
    const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
    const mouseupEvent = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    element.dispatchEvent(mousedownEvent);
    element.dispatchEvent(mouseupEvent);
    element.dispatchEvent(clickEvent);
}

function getAuToken() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('injector.js');
        script.onload = () => script.remove();
        script.onerror = (e) => reject(e);
        (document.head || document.documentElement).appendChild(script);
        const timeout = setTimeout(() => {
            window.removeEventListener('message', onMessage);
            reject(new Error('au_tokenの取得がタイムアウトしました。'));
        }, 3000);
        function onMessage(event) {
            if (event.source === window && event.data && event.data.type === 'FROM_PAGE') {
                clearTimeout(timeout);
                window.removeEventListener('message', onMessage);
                resolve(event.data.au_token);
            }
        }
        window.addEventListener('message', onMessage);
    });
}