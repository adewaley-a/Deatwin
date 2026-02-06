exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { longUrl } = JSON.parse(event.body);
    const API_KEY = process.env.TINYURL_API_KEY;

    // 1. Create a unique branded alias
    // Generates something like 'biotag-a9z2'
    const uniqueId = Math.random().toString(36).substring(2, 6);
    const customAlias = `biotag-${uniqueId}`;

    const response = await fetch("https://api.tinyurl.com/create", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY.trim()}`,
        "Content-Type": "application/json",
        "accept": "application/json"
      },
      body: JSON.stringify({
        url: longUrl,
        domain: "tinyurl.com",
        alias: customAlias 
      })
    });

    const data = await response.json();

    if (response.ok) {
      return {
        statusCode: 200,
        body: JSON.stringify({ shortURL: data.data.tiny_url })
      };
    } else {
      // 2. Enhanced Error Logic:
      // If the alias is STILL taken (rare with the randomizer),
      // we return a clear message to the frontend.
      const errorMsg = data.errors ? data.errors[0] : "Request failed";
      
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: errorMsg,
          suggestion: "Try clicking the button again to generate a new unique alias."
        })
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Function Crash", details: err.message })
    };
  }
};