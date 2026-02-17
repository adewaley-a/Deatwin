const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
admin.initializeApp();

// 1. SECURE DEPOSIT: Prevents "Amount Trap" and "Double Spending"
exports.verifyPaystackPayment = functions.https.onCall(async (data, context) => {
    // Check if user is logged in
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const { reference } = data;
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    try {
        // 1. Ask Paystack for the TRUTH about this reference
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${secretKey}` }
        });

        const transactionData = response.data.data;

        // 2. CHECK THE STATUS: Must be 'success'
        // 3. THE AMOUNT TRAP FIX: We take the amount from Paystack, NOT the user input.
        if (response.data.status === true && transactionData.status === 'success') {
            
            const amountReceived = transactionData.amount / 100; // Convert Kobo to Naira
            const userRef = admin.firestore().collection('users').doc(context.auth.uid);

            // 4. PREVENT REPLAY ATTACKS: Check if this reference was already processed
            const paymentRef = admin.firestore().collection('payments').doc(reference);
            const paymentDoc = await paymentRef.get();

            if (paymentDoc.exists) {
                throw new functions.https.HttpsError('already-exists', 'This transaction has already been credited.');
            }

            // 5. ATOMIC UPDATE: Log the payment and update balance simultaneously
            const batch = admin.firestore().batch();
            
            // Record the reference so it can't be used again
            batch.set(paymentRef, {
                uid: context.auth.uid,
                amount: amountReceived,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            // Credit the user
            batch.update(userRef, {
                wallet_balance: admin.firestore.FieldValue.increment(amountReceived)
            });

            await batch.commit();

            return { success: true, amount: amountReceived };
        } else {
            throw new functions.https.HttpsError('aborted', 'Paystack did not confirm a successful payment.');
        }

    } catch (error) {
        console.error("Verification Error:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// 2. SECURE WITHDRAWAL: Double-checks balance on the server
exports.processWithdrawal = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');

    const { amount } = data;
    const userRef = admin.firestore().collection('users').doc(context.auth.uid);

    // Use a Transaction to ensure balance doesn't change while we are checking it
    return admin.firestore().runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        
        if (!userDoc.exists) throw new Error("User does not exist!");

        const currentBalance = userDoc.data().wallet_balance || 0;

        if (currentBalance >= amount) {
            transaction.update(userRef, {
                wallet_balance: admin.firestore.FieldValue.increment(-amount)
            });
            return { success: true, newMessage: "Withdrawal successful!" };
        } else {
            throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
        }
    });
});