const t = (m) => console.log(`[${Date.now() % 100000}] ${m}`);
t("start");
await import("express"); t("express ok");
await import("cors"); t("cors ok");
await import("socket.io"); t("socket.io ok");
t("done");
