browser.webRequest.onBeforeRequest.addListener(
    function (details) {
        console.log(details.url);
        let filter = browser.webRequest.filterResponseData(
            details.requestId
        );
        let decoder = new TextDecoder("utf-8");


        filter.ondata = (event) => {
            let str = decoder.decode(event.data, { stream: true });
            console.log(str);
            // 現在のタブを取得する
            browser.tabs.query({
                active: true,
                windowId: browser.windows.WINDOW_ID_CURRENT
            }, function (result) {
                var currentTab = result.shift();
                // 取得したタブに対してメッセージを送る
                browser.tabs.sendMessage(currentTab.id, { url: details.url, data: str }, function () { });
            });

            filter.write(event.data);
            filter.disconnect();
        }

    },
    { urls: ['https://supereigo.campus.kit.ac.jp/as/player_data/*', 'https://supereigo.campus.kit.ac.jp/as/flash/tango_data_manipulate.cfc?method=get_question&*'] },
    ["blocking"]
);