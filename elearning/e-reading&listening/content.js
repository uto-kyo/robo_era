// content.js (ページ間待機時間延長・最終完成版)

// ===== メインロジック =====

document.addEventListener('click', async (event) => {
    const clickedElement = event.target;
    const clickedTab = clickedElement.closest('a.book_navi');
    if (clickedTab) {
        const tabName = clickedElement.textContent.trim().replace(/\s+/g, ' ');
        await chrome.storage.local.set({ lastClickedTab: tabName });
    }
    const learningButton = clickedElement.closest('a.btn.btn_dictan[href*="/as/lplayer/index.cfm"]');
    if (learningButton) {
        if (chrome.storage && chrome.runtime?.id) {
            await chrome.storage.local.remove(['fetchRetryCount', 'savedAnswers', 'answeredCount']);
            await chrome.storage.local.set({ shouldFetchAnswers: true });
        } else {
            alert("拡張機能が正しく読み込まれていません。このページを一度リロードしてから、再度お試しください。");
            return;
        }
    }
});

(async () => {
    if (!chrome.runtime?.id || !window.location.href.includes('/as/lplayer/index.cfm')) return;
    const data = await chrome.storage.local.get('shouldFetchAnswers');
    if (data.shouldFetchAnswers) {
        await chrome.storage.local.remove('shouldFetchAnswers');
        await fetchAndThenApply();
    } else {
        applyAnswersFromStorage();
    }
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === "apply") {
        applyAnswersFromStorage();
    }
    return true;
});


// ===== 補助関数 =====

async function fetchAndThenApply() {
    const answers = await fetchAnswers();
    if (answers) {
        await chrome.storage.local.remove('fetchRetryCount');
        waitForChoicesAndApply(answers, 0);
    }
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchAnswers() {
    try {
        const auToken = await getAuToken();
        if (!auToken) throw new Error("au_tokenが見つかりません。");
        const xmlUrl = `https://supereigo.campus.kit.ac.jp/as/player_data/authoring.cfc?method=bookXml&au_token=${auToken}&ran=${Date.now()}`;
        const response = await fetch(xmlUrl);
        if (!response.ok) throw new Error(`XMLの取得に失敗: ${response.statusText}`);
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        const correctAnswers = Array.from(xmlDoc.querySelectorAll('question')).map(q => {
            const answerNo = q.querySelector('answer')?.textContent;
            const choice = q.querySelector(`choice[no="${answerNo}"]`);
            return choice ? choice.textContent.trim() : null;
        }).filter(Boolean);
        if (correctAnswers.length === 0) throw new Error("解答データが空です。");
        await chrome.storage.local.set({ savedAnswers: correctAnswers, answeredCount: 0 });
        console.log('HELPER: 解答リストを保存しました:', correctAnswers);
        return correctAnswers;
    } catch (error) {
        console.error("HELPER (Fetch Error):", error.message);
        await handleFetchError();
        return null;
    }
}

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
            el.click();
            return;
        }
    }
}

async function applyAnswersFromStorage() {
    const data = await chrome.storage.local.get(["savedAnswers", "answeredCount"]);
    if (!data.savedAnswers) return;
    waitForChoicesAndApply(data.savedAnswers, data.answeredCount || 0);
}

function waitForChoicesAndApply(answers, startIndex) {
    let attempts = 0;
    const intervalId = setInterval(() => {
        attempts++;
        let choiceGroups = document.querySelectorAll('ul[class^="MultipleChoiceQuestionBuilder__hBox"]');
        if (choiceGroups.length === 0) {
            choiceGroups = document.querySelectorAll('div[class^="MultipleChoiceQuestionBuilder__choices"]');
        }

        if (choiceGroups.length > 0) {
            clearInterval(intervalId);
            applyClicks(answers, startIndex);
        } else if (attempts >= 15) {
            clearInterval(intervalId);
        }
    }, 1000);
}


async function applyClicks(answers, startIndex) {
    let choiceGroups = document.querySelectorAll('ul[class^="MultipleChoiceQuestionBuilder__hBox"]');
    if (choiceGroups.length === 0) {
        choiceGroups = document.querySelectorAll('div[class^="MultipleChoiceQuestionBuilder__choices"]');
    }

    if (choiceGroups.length === 0) return;

    const clickDelay = 300;
    console.log(`HELPER: ${choiceGroups.length}個の問題を検出。クリック処理を開始します...`);

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
                await delay(clickDelay);
                break;
            }
        }
    }

    const newAnsweredCount = startIndex + choiceGroups.length;
    await chrome.storage.local.set({ answeredCount: newAnsweredCount });
    console.log(`HELPER: 解答済みカウントを更新しました: ${newAnsweredCount}`);

    if (newAnsweredCount < answers.length) {
        clickNextButton();
    } else {
        console.log("HELPER: 全ての解答が完了しました。「採点」ボタンをクリックします。");
        clickConfirmButton();
    }
}


async function clickNextButton() {
    // ★★★【変更点】ここから ★★★
    const { lastClickedTab } = await chrome.storage.local.get('lastClickedTab');
    // 待機時間を延長して安定性を確保
    const waitTime = (lastClickedTab === 'Listening' || lastClickedTab === 'ディクタン') ? 5000 : 2500;
    console.log(`HELPER: 次のページへ移動します。(待機時間: ${waitTime}ms)`);
    // ★★★【変更点】ここまで ★★★

    let attempts = 0;
    const intervalId = setInterval(() => {
        attempts++;
        const nextButton = document.querySelector('#nextButton:not([disabled])');
        if (nextButton) {
            clearInterval(intervalId);
            simulateRealClick(nextButton);
            // ★★★【変更点】待機処理を復活・延長 ★★★
            setTimeout(applyAnswersFromStorage, waitTime);
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