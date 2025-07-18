let one_list = [];
let two_list = [];
let before_ques = "";

const question_elm_root = ".QuestionDirectionText__root___3WtnC";
const question_elm_list = ".MultipleChoiceQuestionBuilder__question___3Xy0n,.QuestionView__question___2d3S6";

//表示の調整
function drawManager(elm) {
    elm.parentNode.insertBefore(elm, elm.parentNode.childNodes[0])
}

//穴埋め選択問題のポップアップにマークする
function pop_up_drawer(answer) {
    const answer_elm_list = ".InsertionQuestionBuilder__insertChoice___2m2E-,.MatchingQuestionBuilder__noSelectDouble___3p47s"
    let answers = document.querySelectorAll(answer_elm_list);
    if (answers.length === 0) {
        requestIdleCallback(() => {
            pop_up_drawer(answer);
        });
        return;
    }
    console.log(answer);
    const correct = Array.from(answers).find(x => x.textContent === answer);
    correct.style.color = '#ff0000';
    if (correct.tagName == "DIV") {
        drawManager(correct)
    } else {
        drawManager(correct.parentNode)
    }
}

//穴埋め選択問題のポップアップに答えを関連づけ
const fill_selection_answer_elm = ".MatchingQuestionBuilder__insertionPosition___g9-VJ,.InsertionQuestionBuilder__insertionPosition___17whp"
function fill_selection_drawer() {
    let answers = document.querySelectorAll(fill_selection_answer_elm);
    for (let i = 0; i < answers.length; i++) {
        const answer = one_list[0];
        answers[i].addEventListener('click', () => {
            pop_up_drawer(answer);
        });
        one_list.shift();
    }
}


//穴埋め問題に答えを表示
const fill_str_question_elm = ".ClozeTestQuestionBuilder__question___2XHYZ,.AnaumeFilInQuestionBuilder__questionBox___1_-Vo"
function fill_str_drawer() {
    const elm = document.querySelectorAll(fill_str_question_elm)[0];
    const input = elm.getElementsByTagName("input");
    for (let i = 0; i < input.length; i++) {
        console.log(one_list[0]);
        input[i].value = one_list[0];
        let html_event = new Event("input", { "bubbles": true, "cancelable": false });
        input[i].dispatchEvent(html_event);
        one_list.shift();
    }
}

//選択問題の答えをマーク
const selection_question_elm = ".MultipleChoiceQuestionBuilder__questionBox___2Nd4y"
function get_selection_answer_elm(question_elm) {
    const question = question_elm.querySelectorAll(question_elm_list)[0].textContent;
    const correct = two_list.find(x => x[0] === question);
    console.log(correct[1]);
    let answers = question_elm.getElementsByClassName("MultipleChoiceQuestionBuilder__choice___OK5tg lang-ja");
    const answer_list = Array.from(answers).map(x => x.getElementsByTagName("button"));
    return answer_list.find(x => x[0].getElementsByTagName("span")[0].textContent === correct[1])[0];
}
function selection_drawer() {
    const question_elm = document.querySelectorAll(selection_question_elm);
    for (let i = 0; i < question_elm.length; i++) {
        const answer = get_selection_answer_elm(question_elm[i]);
        answer.getElementsByTagName("span")[0].style.color = '#ff0000';
        drawManager(answer.parentNode.parentNode)
    }
}

//問題のタイプを判別し描画
function drawer() {
    if (document.querySelectorAll(fill_selection_answer_elm).length > 0) {
        fill_selection_drawer();
    }
    if (document.querySelectorAll(fill_str_question_elm).length > 0) {
        fill_str_drawer();
    }
    if (document.querySelectorAll(selection_question_elm).length > 0) {
        selection_drawer();
    }
}


//問題文の変化を監視
function checker() {
    const question_root = document.querySelectorAll(question_elm_root);
    const question_elm = document.querySelectorAll(question_elm_list);
    let question = before_ques;
    if (question_elm.length > 0) {
        //単独問題用
        question = question_elm[0].textContent;
        if (before_ques !== question) {
            drawer();
        }
    } else if (question_root.length > 0) {
        //複数問題用
        question = question_root[0].textContent;
        if (before_ques !== question) {
            drawer();
        }
    }
    before_ques = question;
    requestIdleCallback(checker);
}

//データの解析（基本）
function xml_perser(data) {
    let dpObj = new DOMParser();
    const xml = dpObj.parseFromString(data, "text/xml");
    const question_root = xml.getElementsByTagName("question");
    for (let i = 0; i < question_root.length; i++) {
        const questions = question_root[i].getElementsByTagName("questionText");
        const answers = question_root[i].getElementsByTagName("answers");
        const choices = question_root[i].getElementsByTagName("choices");
        if (choices.length != 0) {
            //選択問題
            let result = [];
            result[0] = questions[0].textContent.replace(/ +$/g, "").replace("\n", "");
            const choice = choices[0].getElementsByTagName("choice");
            const num = Number(answers[0].textContent);
            result[1] = choice[num - 1].textContent;
            two_list.push(result);
        } else {
            //穴埋め
            let str = questions[0].textContent;
            str = str.replace("<![CDATA[", "").replace("]]>", "");
            let strs = str.match(/\[.+?\]/g);
            strs = strs.map(x => x.replace("[", "").replace("]", ""));
            one_list = one_list.concat(strs);
        }

    }
}

//データの解析（単語用）
function json_perser(data) {
    const jsonObj = JSON.parse(data);
    const questions = jsonObj["questions"];
    for (let i = 0; i < questions.length; i++) {
        let result = [];
        result[0] = questions[i]["keyword"]["en"];
        result[1] = questions[i]["keyword"]["ja"];
        two_list.push(result);
    }
}


//問題・回答が含まれたデータを受け取る
browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    console.log(message);
    if (message["url"].indexOf("tango_data_manipulate.cfc") == -1) {
        xml_perser(message["data"]);
    } else {
        json_perser(message["data"]);
    }

    console.log(one_list);
    console.log(two_list);
    checker();
});