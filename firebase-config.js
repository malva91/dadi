const firebaseConfig = {
    apiKey: "AIzaSyBek0A-fUWzmRdX1NVLhC9tzE2C9_VZEaI",
    authDomain: "dadi-311e5.firebaseapp.com",
    databaseURL: "https://dadi-311e5-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "dadi-311e5",
    storageBucket: "dadi-311e5.firebasestorage.app",
    messagingSenderId: "203636655353",
    appId: "1:203636655353:web:a9d8a032ed96ddc7c28e28"
};

try {
    // Inizializza Firebase
    if (!firebase || typeof firebase.initializeApp !== 'function') {
        throw new Error('Firebase non caricato correttamente');
    }

    firebase.initializeApp(firebaseConfig);
    window.database = firebase.database();
    window.firestore = firebase.firestore();

    if (!window.database) {
        throw new Error('Firebase Realtime Database non inizializzato');
    }

    if (!window.firestore) {
        throw new Error('Firebase Firestore non inizializzato');
    }

    console.log('✅ Firebase inizializzato correttamente');
    console.log('✅ Database:', window.database ? 'OK' : 'ERRORE');
    console.log('✅ Firestore:', window.firestore ? 'OK' : 'ERRORE');

} catch (error) {
    console.error('❌ Errore inizializzazione Firebase:', error);
    alert('❌ Errore di connessione al database. Verifica la tua connessione internet e ricarica la pagina.');
}