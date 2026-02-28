import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";


const firebaseConfig = {
  apiKey: "AIzaSyBxQd9n0tz2gsKZQZIBq_qqpqPcdcH5HCM",
  authDomain: "led-build-pro.firebaseapp.com",
  projectId: "led-build-pro",
  storageBucket: "led-build-pro.firebasestorage.app",
  messagingSenderId: "826806320809",
  appId: "1:826806320809:web:7e6cbb1c7b4aa8c3ab33b8",
  measurementId: "G-BYQTTDQSBH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export the Auth and Database tools so your Vue app can use them
export const auth = getAuth(app);
export const db = getFirestore(app);