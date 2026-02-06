import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth"; // Add these

const firebaseConfig = {
  apiKey: "AIzaSyDH3rTYuZb5Vyn7O1qgHiI_rrc0DPawkAc", // Ensure this is a string or your env variable
  authDomain: "deatwin-6f70b.firebaseapp.com",
  projectId: "deatwin-6f70b",
  storageBucket: "deatwin-6f70b.firebasestorage.app",
  messagingSenderId: "1041917039721",
  appId: "1:1041917039721:web:409f4d3ff2d3d76000bef8",
  measurementId: "G-F312DE7LX7"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();