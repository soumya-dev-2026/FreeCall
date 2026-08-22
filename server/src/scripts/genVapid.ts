/**
 * Generates a VAPID keypair for Web Push.
 * Run:  npm run genkeys
 * Then copy the values into server/.env
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("\nAdd these to server/.env:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("\nKeep the private key secret.\n");
