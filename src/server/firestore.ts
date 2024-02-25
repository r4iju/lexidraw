import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { env } from "~/env";

const firebaseConfig = {
  apiKey: env.NEXT_PUBLIC_FIRESTORE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIRESTORE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIRESTORE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIRESTORE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIRESTORE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIRESTORE_APP_ID,
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
const firestore = initializeFirestore(app, {
  ignoreUndefinedProperties: true
})
export default firestore;