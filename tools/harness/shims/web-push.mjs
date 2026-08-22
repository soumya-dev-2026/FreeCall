/** web-push shim: records sends so the harness can assert on them. */
export const sent = [];
let vapid = null;

function setVapidDetails(subject, publicKey, privateKey) {
  vapid = { subject, publicKey, privateKey };
}
function generateVAPIDKeys() {
  return { publicKey: "shim-public-key", privateKey: "shim-private-key" };
}
async function sendNotification(subscription, payload) {
  if (!vapid) throw new Error("setVapidDetails not called");
  sent.push({ endpoint: subscription?.endpoint, payload });
  return { statusCode: 201 };
}

export { setVapidDetails, generateVAPIDKeys, sendNotification };
export default { setVapidDetails, generateVAPIDKeys, sendNotification, sent };
