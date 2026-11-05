(() => {
  "use strict";
  const CONFIG = {
    url: "https://cypbjzbagezdelmemuhb.supabase.co",
    key: "sb_publishable_8W8zyYtggQMWoFlnxrzoVA_BUKjQ9va"
  };
  let clientPromise = null;

  async function getClient() {
    if (window.StoreNestCustomerClient) return window.StoreNestCustomerClient;
    if (!clientPromise) {
      clientPromise = (async () => {
        if (!window.supabase) {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0";
            script.onload = resolve;
            script.onerror = () => reject(new Error("Unable to load secure sign-in. Check your connection and try again."));
            document.head.appendChild(script);
          });
        }
        if (!window.supabase) throw new Error("Secure sign-in is unavailable.");
        window.StoreNestCustomerClient = window.supabase.createClient(CONFIG.url, CONFIG.key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: "storenest-customer-auth-v1"
          }
        });
        return window.StoreNestCustomerClient;
      })().catch(error => {
        clientPromise = null;
        throw error;
      });
    }
    return clientPromise;
  }

  function normalizePhone(value) {
    let digits = String(value || "").trim().replace(/[^0-9+]/g, "");
    if (digits.startsWith("00")) digits = "+" + digits.slice(2);
    else if (digits.startsWith("+")) digits = "+" + digits.slice(1).replace(/\D/g, "");
    else {
      digits = digits.replace(/\D/g, "");
      if (/^0\d{9}$/.test(digits)) digits = "+27" + digits.slice(1);
      else if (/^27\d{9}$/.test(digits)) digits = "+" + digits;
      else digits = "+" + digits;
    }
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : "";
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  async function sendCode(method, value) {
    const client = await getClient();
    if (method === "email") {
      const email = normalizeEmail(value);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
      const result = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (result.error) throw result.error;
      return { method, destination: email };
    }
    const phone = normalizePhone(value);
    if (!phone) throw new Error("Enter a valid phone number, such as 072 123 4567 or +27 72 123 4567.");
    const result = await client.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
    if (result.error) {
      if (/unsupported phone provider/i.test(result.error.message || "")) {
        throw new Error("Phone codes are not enabled yet because this project has no SMS provider configured. Choose Email to receive your confirmation code.");
      }
      throw result.error;
    }
    return { method: "phone", destination: phone };
  }

  async function verifyCode(method, destination, token) {
    const client = await getClient();
    const code = String(token || "").trim().replace(/\s/g, "");
    if (!/^\d{6,8}$/.test(code)) throw new Error("Enter the confirmation code you received.");
    const input = method === "email"
      ? { email: normalizeEmail(destination), token: code, type: "email" }
      : { phone: normalizePhone(destination), token: code, type: "sms" };
    const result = await client.auth.verifyOtp(input);
    if (result.error) throw result.error;
    return result.data;
  }

  function normalizeAuthDestination(method, value) {
    if (method === "email") {
      const email = normalizeEmail(value);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
      return email;
    }
    const phone = normalizePhone(value);
    if (!phone) throw new Error("Enter a valid phone number, such as 072 123 4567 or +27 72 123 4567.");
    return phone;
  }

  function phoneProviderError(error) {
    if (/unsupported phone provider|phone provider is not enabled/i.test(error?.message || "")) {
      return new Error("Phone confirmation codes are not enabled yet because this project has no SMS provider configured. Choose Email or ask the store owner to enable an SMS provider.");
    }
    return error;
  }

  async function createAccount(method, value, password, metadata = {}) {
    const client = await getClient();
    const destination = normalizeAuthDestination(method, value);
    const secret = String(password || "");
    if (secret.length < 8) throw new Error("Choose a password with at least 8 characters.");
    const options = { data: metadata && typeof metadata === "object" ? metadata : {} };
    if (method === "phone") options.channel = "sms";
    const credentials = method === "email"
      ? { email: destination, password: secret, options }
      : { phone: destination, password: secret, options };
    const result = await client.auth.signUp(credentials);
    if (result.error) throw phoneProviderError(result.error);
    return { method, destination, user: result.data?.user || null, session: result.data?.session || null };
  }

  async function resendConfirmation(method, destination) {
    const client = await getClient();
    const value = normalizeAuthDestination(method, destination);
    const input = method === "email"
      ? { type: "signup", email: value }
      : { type: "sms", phone: value };
    const result = await client.auth.resend(input);
    if (result.error) throw phoneProviderError(result.error);
    return { method, destination: value };
  }

  async function signInWithPassword(method, value, password) {
    const client = await getClient();
    const destination = normalizeAuthDestination(method, value);
    const secret = String(password || "");
    if (!secret) throw new Error("Enter your password.");
    const credentials = method === "email"
      ? { email: destination, password: secret }
      : { phone: destination, password: secret };
    const result = await client.auth.signInWithPassword(credentials);
    if (result.error) throw phoneProviderError(result.error);
    return result.data;
  }

  async function getProfile(userId) {
    const client = await getClient();
    const id = userId || (await client.auth.getUser()).data?.user?.id;
    if (!id) return null;
    const { data, error } = await client
      .from("customer_profiles")
      .select("user_id,profile_name,place,exact_address,created_at,updated_at")
      .eq("user_id", id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function saveProfile(user, fields) {
    if (!user?.id) throw new Error("Confirm your email or phone before saving your profile.");
    const profileName = String(fields?.profile_name || "").trim();
    const place = String(fields?.place || "").trim();
    const exactAddress = String(fields?.exact_address || "").trim();
    if (profileName.length < 2 || profileName.length > 100) throw new Error("Profile name must be between 2 and 100 characters.");
    if (place.length < 2 || place.length > 120) throw new Error("Place must be between 2 and 120 characters.");
    if (exactAddress.length > 280) throw new Error("Exact address must be 280 characters or fewer.");
    const client = await getClient();
    const row = {
      user_id: user.id,
      profile_name: profileName,
      place,
      exact_address: exactAddress || null,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await client
      .from("customer_profiles")
      .upsert(row, { onConflict: "user_id" })
      .select("user_id,profile_name,place,exact_address,created_at,updated_at")
      .single();
    if (error) throw error;
    return data;
  }

  window.StoreNestCustomerAuth = { getClient, normalizePhone, normalizeEmail, sendCode, verifyCode, createAccount, resendConfirmation, signInWithPassword, getProfile, saveProfile };
})();