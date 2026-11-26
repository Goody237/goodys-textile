const SUPABASE_SDK_URL = 'https://esm.sh/@supabase/supabase-js@2.119.2';
const MINIMUM_PASSWORD_LENGTH = 8;

const resetDescription = document.getElementById('resetDescription');
const resetMessage = document.getElementById('resetMessage');
const resetForm = document.getElementById('resetForm');
const newPassword = document.getElementById('newPassword');
const confirmPassword = document.getElementById('confirmPassword');
const updatePasswordButton = document.getElementById('updatePasswordButton');
const resetSuccessActions = document.getElementById('resetSuccessActions');

function showMessage(message, state = '') {
  resetMessage.textContent = message;
  resetMessage.classList.toggle('is-error', state === 'error');
}

function showSuccess(message) {
  resetForm.hidden = true;
  resetDescription.textContent = 'Password updated';
  resetSuccessActions.hidden = false;
  showMessage(message);
}

function showInvalidLink() {
  resetForm.hidden = true;
  resetDescription.textContent = 'Recovery link unavailable';
  showMessage(
    'This password recovery link is invalid or has expired. Request a new recovery email from the admin sign-in screen.',
    'error'
  );
}

function isServiceRoleKey(value) {
  if (value.startsWith('sb_secret_')) return true;
  const payload = value.split('.')[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return JSON.parse(decoded).role === 'service_role';
  } catch {
    return false;
  }
}

function validateConfiguration(config) {
  const url = config.SUPABASE_URL;
  const key = config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_ANON_KEY;
  if (typeof url !== 'string' || typeof key !== 'string' || !key.trim()) {
    return { error: 'The dashboard Supabase configuration is missing.' };
  }
  if (/YOUR_|REPLACE_ME|PLACEHOLDER/i.test(url + key)) {
    return { error: 'The dashboard Supabase configuration has not been set.' };
  }
  try {
    if (new URL(url).protocol !== 'https:') {
      return { error: 'The Supabase Project URL must use HTTPS.' };
    }
  } catch {
    return { error: 'The Supabase Project URL is not valid.' };
  }
  if (isServiceRoleKey(key.trim())) {
    return { error: 'A service-role key was rejected. Use only the publishable/anon key.' };
  }
  return { url: url.replace(/\/+$/, ''), key: key.trim() };
}

async function initialize() {
  let configResponse;
  try {
    configResponse = await fetch('./supabase-config.js', {
      method: 'HEAD',
      cache: 'no-store'
    });
  } catch {
    showInvalidLink();
    return;
  }
  if (!configResponse.ok) {
    showInvalidLink();
    return;
  }

  let configModule;
  try {
    configModule = await import('./supabase-config.js');
  } catch (error) {
    console.error('Supabase configuration could not be loaded:', error);
    showInvalidLink();
    return;
  }

  const config = validateConfiguration(configModule);
  if (config.error) {
    showMessage(config.error, 'error');
    resetDescription.textContent = 'Configuration unavailable';
    return;
  }

  let createClient;
  try {
    ({ createClient } = await import(SUPABASE_SDK_URL));
  } catch (error) {
    console.error('Supabase client could not be loaded:', error);
    showMessage('The Supabase client could not be loaded. Check network access and try again.', 'error');
    return;
  }

  let supabase;
  try {
    supabase = createClient(config.url, config.key, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    });
  } catch (error) {
    console.error('Supabase client initialization failed:', error);
    showMessage(`Supabase could not be initialized: ${error.message}`, 'error');
    return;
  }

  let recoverySessionReady = false;

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) {
      recoverySessionReady = true;
      resetDescription.textContent = 'Enter a new password';
      resetForm.hidden = false;
      showMessage('Recovery link verified. Choose a new password.');
    }
  });

  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '');
  const errorDescription =
    hashParams.get('error_description') || url.searchParams.get('error_description');

  if (errorDescription) {
    showInvalidLink();
    return;
  }

  const code = url.searchParams.get('code');
  if (code) {
    try {
      const exchange = await supabase.auth.exchangeCodeForSession(code);
      if (exchange.error) {
        console.error('Recovery code exchange failed:', exchange.error);
        showInvalidLink();
        return;
      }
      if (exchange.data && exchange.data.session) {
        recoverySessionReady = true;
        resetDescription.textContent = 'Enter a new password';
        resetForm.hidden = false;
        showMessage('Recovery link verified. Choose a new password.');
      }
    } catch (error) {
      console.error('Recovery code exchange failed:', error);
      showInvalidLink();
      return;
    }
  }

  if (!recoverySessionReady) {
    try {
      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.error) {
        console.error('Recovery session could not be checked:', sessionResult.error);
        showInvalidLink();
        return;
      }
      if (sessionResult.data && sessionResult.data.session) {
        recoverySessionReady = true;
        resetDescription.textContent = 'Enter a new password';
        resetForm.hidden = false;
        showMessage('Recovery link verified. Choose a new password.');
      } else {
        showInvalidLink();
      }
    } catch (error) {
      console.error('Recovery session could not be checked:', error);
      showInvalidLink();
    }
  }

  resetForm.addEventListener('submit', async event => {
    event.preventDefault();

    const password = newPassword.value;
    const confirmation = confirmPassword.value;
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      showMessage(
        `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
        'error'
      );
      newPassword.focus();
      return;
    }
    if (password !== confirmation) {
      showMessage('The password entries do not match.', 'error');
      confirmPassword.focus();
      return;
    }

    updatePasswordButton.disabled = true;
    showMessage('Updating password…');
    try {
      const result = await supabase.auth.updateUser({ password });
      if (result.error) {
        console.error('Password update failed:', result.error);
        showMessage(`Password could not be updated: ${result.error.message}`, 'error');
        return;
      }

      newPassword.value = '';
      confirmPassword.value = '';
      await supabase.auth.signOut({ scope: 'local' }).catch(error => {
        console.error('Password reset sign-out could not complete:', error);
      });
      showSuccess('Your password has been updated successfully. Sign in again with your new password.');
    } catch (error) {
      console.error('Password update failed:', error);
      showMessage(`Password could not be updated: ${error.message}`, 'error');
    } finally {
      updatePasswordButton.disabled = false;
    }
  });
}

initialize();
