const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialize admin once
if (admin.apps.length === 0) {
    admin.initializeApp();
}

exports.paystackWebhook = functions.https.onRequest(async (req, res) => {
    // 1. SECURITY: Verify this actually came from Paystack
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];
    
    // Calculate hash of the body using your secret key
    const hash = crypto
        .createHmac('sha512', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');

    if (hash !== signature) {
        console.error("Invalid Webhook Signature!");
        return res.status(401).send('Unauthorized');
    }

    const event = req.body;

    // 2. LOGIC: Only proceed if it's a successful payment
    if (event.event === 'charge.success') {
        const { reference, amount, customer } = event.data;
        const amountInNaira = amount / 100;

        try {
            const db = admin.firestore();
            const paymentRef = db.collection('payments').doc(reference);
            
            // Use a transaction to prevent double-crediting if Paystack sends the webhook twice
            await db.runTransaction(async (t) => {
                const payDoc = await t.get(paymentRef);
                if (payDoc.exists) return; // Already processed

                // Find user by email (sent by Paystack)
                const userQuery = await db.collection('users').where('email', '==', customer.email).limit(1).get();
                
                if (!userQuery.empty) {
                    const userDoc = userQuery.docs[0];
                    t.set(paymentRef, {
                        uid: userDoc.id,
                        amount: amountInNaira,
                        status: 'success',
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                    t.update(userDoc.ref, {
                        wallet_balance: admin.firestore.FieldValue.increment(amountInNaira)
                    });
                }
            });

            return res.status(200).send('Success');
        } catch (err) {
            console.error("Webhook Firestore Error:", err);
            return res.status(500).send('Internal Error');
        }
    }

    // Acknowledge other events but do nothing
    res.status(200).send('Event Ignored');
});