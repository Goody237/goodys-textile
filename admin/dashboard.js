import { configureCurrency, formatCurrency } from '../content/currency.js';

const SUPABASE_SDK_URL = 'https://esm.sh/@supabase/supabase-js@2.119.2';
const PRODUCT_IMAGE_BUCKET = 'product-images';
const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};
const PRODUCT_COLUMNS = [
  'id',
  'sku',
  'title',
  'category',
  'image_url',
  'gallery',
  'description',
  'featured',
  'selling_unit',
  'price',
  'minimum_quantity',
  'quantity_step',
  'stock_status',
  'is_published',
  'is_archived'
].join(',');
const STOCK_LABELS = {
  in_stock: 'IN STOCK',
  out_of_stock: 'OUT OF STOCK'
};
const UNKNOWN_STOCK_LABEL = 'AVAILABILITY TO BE CONFIRMED';

const views = [...document.querySelectorAll('[data-admin-view]')];
const navigationButtons = [...document.querySelectorAll('[data-view]')];
const pageTitle = document.getElementById('pageTitle');
const productsStatus = document.getElementById('productStatus');
const productsBody = document.getElementById('productRows');
const productSearch = document.getElementById('productSearch');
const categoryFilter = document.getElementById('categoryFilter');
const productArchiveFilter = document.getElementById('productArchiveFilter');
const productMetric = document.getElementById('productMetric');
const availabilityMetric = document.getElementById('availabilityMetric');
const productEditor = document.getElementById('productEditor');
const productForm = document.getElementById('productForm');
const addProductButton = document.getElementById('addProductButton');
const editorTitle = document.getElementById('editorTitle');
const editorMessage = document.getElementById('editorMessage');
const saveProductButton = document.getElementById('saveProductButton');
const productImageFile = document.getElementById('productImageFile');
const imagePreview = document.getElementById('imagePreview');
const imagePreviewImage = document.getElementById('imagePreviewImage');
const imagePreviewLabel = document.getElementById('imagePreviewLabel');
const imageUploadProgress = document.getElementById('imageUploadProgress');
const imageUploadStatus = document.getElementById('imageUploadStatus');
const closeEditorButton = document.getElementById('closeEditorButton');
const cancelEditorButton = document.getElementById('cancelEditorButton');
const authGate = document.getElementById('authGate');
const authMessage = document.getElementById('authMessage');
const loginForm = document.getElementById('loginForm');
const recoveryForm = document.getElementById('recoveryForm');
const recoveryEmail = document.getElementById('recoveryEmail');
const loginButton = document.getElementById('loginButton');
const sendRecoveryButton = document.getElementById('sendRecoveryButton');
const retryAuthButton = document.getElementById('retryAuthButton');
const dashboardApp = document.getElementById('dashboardApp');
const connectionStatus = document.getElementById('connectionStatus');
const connectionIndicator = document.getElementById('connectionIndicator');
const adminIdentity = document.getElementById('adminIdentity');
const archiveConfirmationDialog = document.getElementById('archiveConfirmationDialog');
const archiveConfirmationTitle = document.getElementById('archiveConfirmationTitle');
const archiveConfirmationProductName = document.getElementById('archiveConfirmationProductName');
const archiveConfirmationDescription = document.getElementById('archiveConfirmationDescription');
const archiveConfirmationMessage = document.getElementById('archiveConfirmationMessage');
const cancelArchiveButton = document.getElementById('cancelArchiveButton');
const confirmArchiveButton = document.getElementById('confirmArchiveButton');
const settingsCategories = document.getElementById('settingsCategories');
const settingsContent = document.getElementById('settingsContent');
const settingsStatus = document.getElementById('settingsStatus');
const reloadSettingsButton = document.getElementById('reloadSettingsButton');
const productPriceHeading = document.getElementById('productPriceHeading');
const editorCurrencyLabel = document.getElementById('editorCurrencyLabel');

const fields = {
  id: document.getElementById('fieldId'),
  sku: document.getElementById('fieldSku'),
  title: document.getElementById('fieldTitle'),
  category: document.getElementById('fieldCategory'),
  image_url: document.getElementById('fieldImage'),
  gallery: document.getElementById('fieldGallery'),
  description: document.getElementById('fieldDescription'),
  selling_unit: document.getElementById('fieldUnit'),
  price: document.getElementById('fieldPrice'),
  minimum_quantity: document.getElementById('fieldMinimum'),
  quantity_step: document.getElementById('fieldStep'),
  stock_status: document.getElementById('fieldStockStatus'),
  featured: document.getElementById('fieldFeatured'),
  is_published: document.getElementById('fieldPublished')
};

let catalogue = [];
let supabase = null;
let supabaseUrl = '';
let supabasePublishableKey = '';
let administrator = null;
let schemaVerified = false;
let editingProduct = null;
let localImagePreviewUrl = null;
let isSavingProduct = false;
let imageSelectionVersion = 0;
let pendingArchiveAction = null;
let isUpdatingArchive = false;
let adminContext = null;
let publicSettings = {};
let privateSettings = {};
let activeSettingsCategory = 'business';
let isLoadingSettings = false;

const DELEGATABLE_PERMISSIONS = [
  ['products.read', 'Read products'],
  ['products.manage', 'Create, edit, publish, archive and restore products'],
  ['orders.read', 'Read orders'],
  ['orders.manage', 'Manage orders'],
  ['wholesale.read', 'Read wholesale quotations'],
  ['wholesale.manage', 'Manage wholesale quotations'],
  ['settings.business.read', 'Read business settings'],
  ['settings.business.manage', 'Edit business settings']
];

const SETTINGS_CATEGORIES = [
  {
    id: 'business',
    title: 'Business Information',
    permission: 'settings.business.read',
    managePermission: 'settings.business.manage',
    fields: [
      { key: 'brand_name', label: 'Business name', maxLength: 80, required: true },
      { key: 'tagline', label: 'Tagline', maxLength: 120, required: true },
      { key: 'location', label: 'Business location', maxLength: 160, required: true }
    ]
  },
  {
    id: 'branding',
    title: 'Branding and Appearance',
    permission: 'settings.business.read',
    managePermission: 'settings.business.manage',
    fields: [
      { key: 'hero_title', label: 'Storefront headline', maxLength: 140, required: true },
      { key: 'hero_text', label: 'Storefront introduction', type: 'textarea', maxLength: 700, wide: true },
      { key: 'about_title', label: 'About heading', maxLength: 140, required: true },
      { key: 'about_text', label: 'About text', type: 'textarea', maxLength: 700, wide: true },
      { key: 'accent_color', label: 'Accent color', type: 'color', required: true }
    ]
  },
  {
    id: 'social',
    title: 'Social Media and Contact',
    permission: 'settings.business.read',
    managePermission: 'settings.business.manage',
    fields: [
      { key: 'phone', label: 'Phone number', maxLength: 32, required: true },
      { key: 'whatsapp', label: 'WhatsApp number (digits only)', pattern: '[0-9]{7,20}', maxLength: 20, required: true },
      { key: 'contact_email', label: 'Public contact email', type: 'email', maxLength: 254 },
      { key: 'facebook_url', label: 'Facebook URL', type: 'url', maxLength: 500 },
      { key: 'instagram_url', label: 'Instagram URL', type: 'url', maxLength: 500 },
      { key: 'tiktok_url', label: 'TikTok URL', type: 'url', maxLength: 500 }
    ]
  },
  {
    id: 'storefront',
    title: 'Storefront and Catalogue',
    permission: 'settings.business.read',
    managePermission: 'settings.business.manage',
    fields: [
      { key: 'catalogue_message', label: 'Catalogue introduction', type: 'textarea', maxLength: 500, wide: true }
    ],
    note: 'Public visibility remains controlled by each product’s published and archived state. This setting does not override catalogue access rules.'
  },
  {
    id: 'pricing',
    title: 'Pricing and Currency',
    permission: 'settings.business.read',
    managePermission: 'settings.business.manage',
    fields: [
      { key: 'currency_code', label: 'ISO currency code', maxLength: 3, pattern: '[A-Z]{3}', required: true },
      { key: 'currency_label', label: 'Displayed currency label', maxLength: 12, required: true },
      { key: 'currency_locale', label: 'Number formatting locale', maxLength: 16, pattern: '[a-z]{2}(-[A-Z]{2})?', required: true }
    ],
    note: 'Changing the currency display does not convert or rewrite existing product prices.'
  },
  {
    id: 'orders',
    title: 'Orders and Fulfillment',
    permission: 'settings.business.read',
    managePermission: 'settings.business.manage',
    fields: [
      { key: 'order_whatsapp_message', label: 'WhatsApp order-enquiry closing message', type: 'textarea', maxLength: 500, wide: true }
    ],
    note: 'Retail checkout remains a WhatsApp enquiry. No order-processing or fulfillment backend is connected.'
  },
  {
    id: 'wholesale',
    title: 'Wholesale Management',
    permission: 'settings.business.read',
    managePermission: 'settings.business.manage',
    fields: [
      { key: 'wholesale_whatsapp_message', label: 'WhatsApp wholesale-enquiry message', type: 'textarea', maxLength: 500, wide: true }
    ],
    note: 'Wholesale enquiries continue through WhatsApp and are not stored as database quotations.'
  },
  {
    id: 'notifications',
    title: 'Notifications',
    mainOnly: true,
    information: 'No email, SMS, or push-notification provider is connected. Notification delivery settings are intentionally not shown as editable controls.'
  },
  {
    id: 'seo',
    title: 'Website and SEO',
    permission: 'settings.business.read',
    managePermission: 'settings.business.manage',
    fields: [
      { key: 'seo_title', label: 'Page title', maxLength: 160, required: true },
      { key: 'seo_description', label: 'Meta description', type: 'textarea', maxLength: 320, wide: true },
      { key: 'seo_image_url', label: 'Social preview image URL (HTTPS)', type: 'url', maxLength: 500 }
    ]
  },
  {
    id: 'dashboard',
    title: 'Dashboard Preferences',
    permission: 'dashboard.preferences.manage',
    managePermission: 'dashboard.preferences.manage',
    private: true,
    fields: [
      {
        key: 'dashboard_default_view',
        label: 'Default dashboard section',
        type: 'select',
        options: [['overview', 'Overview'], ['products', 'Products']]
      },
      {
        key: 'dashboard_product_filter',
        label: 'Default product filter',
        type: 'select',
        options: [['active', 'Active products'], ['archived', 'Archived products']]
      }
    ],
    note: 'These preferences are private to your signed-in administrator account.'
  },
  {
    id: 'administration',
    title: 'Administration and Permissions',
    mainOnly: true,
    administration: true
  },
  {
    id: 'infrastructure',
    title: 'Infrastructure and Security',
    mainOnly: true,
    infrastructure: true
  }
];

const viewTitles = {
  overview: 'Overview',
  products: 'Products',
  orders: 'Orders',
  quotations: 'Wholesale quotations',
  settings: 'Settings Center'
};

function hasPermission(permission) {
  return Boolean(
    adminContext &&
    adminContext.role === 'main'
  ) || Boolean(
    adminContext &&
    Array.isArray(adminContext.permissions) &&
    adminContext.permissions.includes(permission)
  );
}

function canOpenView(name) {
  if (name === 'overview') return true;
  if (name === 'products') return hasPermission('products.read');
  if (name === 'orders') return hasPermission('orders.read');
  if (name === 'quotations') return hasPermission('wholesale.read');
  if (name === 'settings') {
    return SETTINGS_CATEGORIES.some(category =>
      category.mainOnly
        ? adminContext && adminContext.role === 'main'
        : hasPermission(category.permission)
    );
  }
  return false;
}

function showView(name) {
  if (!canOpenView(name)) return;
  const selectedView = views.find(view => view.dataset.adminView === name);
  if (!selectedView) return;

  views.forEach(view => {
    view.hidden = view !== selectedView;
  });
  navigationButtons.forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  pageTitle.textContent = viewTitles[name] || 'Overview';
}

function renderNavigationAccess() {
  navigationButtons.forEach(button => {
    button.hidden = !canOpenView(button.dataset.view);
  });
}

function cellText(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function updateConnectionStatus(message, state = '') {
  connectionStatus.textContent = message;
  connectionIndicator.classList.toggle('is-connected', state === 'connected');
  connectionIndicator.classList.toggle('is-error', state === 'error');
}

function showAuthState(state, message) {
  authGate.hidden = false;
  dashboardApp.hidden = true;
  authMessage.textContent = message;
  authMessage.classList.toggle('is-error', state === 'error' || state === 'unauthorized');
  loginForm.hidden = state !== 'login' && state !== 'unauthorized';
  recoveryForm.hidden = state !== 'recovery';
  retryAuthButton.hidden = state !== 'error' && state !== 'retry';
}

function showEditorMessage(message = '', state = '') {
  editorMessage.textContent = message;
  editorMessage.classList.toggle('is-error', state === 'error');
  editorMessage.classList.toggle('is-success', state === 'success');
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
    return { error: 'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in admin/supabase-config.js.' };
  }
  if (/YOUR_|REPLACE_ME|PLACEHOLDER/i.test(url + key)) {
    return { error: 'Replace the placeholder values in admin/supabase-config.js with the Supabase Project URL and publishable/anon key.' };
  }
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') {
      return { error: 'The Supabase Project URL must use HTTPS.' };
    }
  } catch {
    return { error: 'The Supabase Project URL is not valid.' };
  }
  if (isServiceRoleKey(key.trim())) {
    return { error: 'A service-role key was rejected. Use only the publishable/anon key in browser code.' };
  }
  return { url: url.replace(/\/+$/, ''), key: key.trim() };
}

function safeImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === 'https:' ||
        (url.protocol === 'http:' && url.origin === window.location.origin)) {
      return url.href;
    }
  } catch {
    return '';
  }
  return '';
}

function validateProductImage(file) {
  if (!file) throw new Error('Choose an image file to upload.');
  if (!Object.prototype.hasOwnProperty.call(PRODUCT_IMAGE_TYPES, file.type)) {
    throw new Error('Choose a JPG, JPEG, PNG or WEBP image.');
  }
  if (file.size <= 0) throw new Error('The selected image file is empty.');
  if (file.size > MAX_PRODUCT_IMAGE_SIZE) {
    throw new Error('The image must be 5 MB or smaller.');
  }
}

function validateProductImageContent(file) {
  return new Promise((resolve, reject) => {
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    const finish = error => {
      URL.revokeObjectURL(previewUrl);
      if (error) reject(error);
      else resolve();
    };
    image.onload = () => finish();
    image.onerror = () => finish(
      new Error('The selected file is not a valid image. Choose a valid JPG, PNG or WEBP image.')
    );
    image.src = previewUrl;
  });
}

function setImageUploadMessage(message, state = '') {
  imageUploadStatus.textContent = message;
  imageUploadStatus.classList.toggle('is-error', state === 'error');
  imageUploadStatus.classList.toggle('is-success', state === 'success');
}

function revokeLocalImagePreview() {
  if (localImagePreviewUrl) {
    URL.revokeObjectURL(localImagePreviewUrl);
    localImagePreviewUrl = null;
  }
}

function showImagePreview(source, label, isLocal = false) {
  const previewSource = isLocal ? source : safeImageUrl(source);
  if (!previewSource) {
    imagePreview.hidden = true;
    imagePreviewImage.removeAttribute('src');
    imagePreviewLabel.textContent = '';
    return;
  }

  imagePreviewImage.alt = label;
  imagePreviewLabel.textContent = label;
  imagePreview.hidden = false;
  imagePreviewImage.onerror = () => {
    imagePreview.hidden = true;
    setImageUploadMessage('The image preview could not be loaded. Check the image URL or choose another file.', 'error');
  };
  imagePreviewImage.src = previewSource;
}

function resetImageUpload(imageUrl = '') {
  revokeLocalImagePreview();
  productImageFile.value = '';
  imageUploadProgress.hidden = true;
  imageUploadProgress.value = 0;
  showImagePreview(imageUrl, imageUrl ? 'Current product image' : '');
  setImageUploadMessage(
    imageUrl
      ? 'Current image shown. Choose a file to replace it, or leave this empty to keep it.'
      : 'Choose an image file to preview and upload.'
  );
}

async function handleProductImageSelection() {
  const selectionVersion = ++imageSelectionVersion;
  revokeLocalImagePreview();
  imageUploadProgress.hidden = true;
  imageUploadProgress.value = 0;

  const file = productImageFile.files && productImageFile.files[0];
  if (!file) {
    showImagePreview(fields.image_url.value.trim(), 'Current product image');
    setImageUploadMessage('No replacement selected. The current image URL will be kept.');
    return;
  }

  try {
    validateProductImage(file);
    setImageUploadMessage('Checking image file…');
    await validateProductImageContent(file);
    if (selectionVersion !== imageSelectionVersion) return;
    localImagePreviewUrl = URL.createObjectURL(file);
    showImagePreview(localImagePreviewUrl, 'Selected image preview', true);
    setImageUploadMessage(`${file.name} is ready to upload.`);
  } catch (error) {
    if (selectionVersion !== imageSelectionVersion) return;
    productImageFile.value = '';
    showImagePreview(fields.image_url.value.trim(), 'Current product image');
    setImageUploadMessage(error.message, 'error');
  }
}

function createUniqueImagePath(file) {
  const extension = PRODUCT_IMAGE_TYPES[file.type];
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const uuid = [...bytes].map((byte, index) => {
    const value = byte.toString(16).padStart(2, '0');
    return `${value}${[3, 5, 7, 9].includes(index) ? '-' : ''}`;
  }).join('');
  return `${uuid}.${extension}`;
}

async function uploadProductImage(file) {
  if (!supabase || !administrator || !hasPermission('products.manage')) {
    throw new Error('Sign in as an authorized administrator before uploading images.');
  }
  validateProductImage(file);

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) {
    throw new Error(`Could not verify the administrator session: ${sessionResult.error.message}`);
  }
  const accessToken = sessionResult.data &&
    sessionResult.data.session &&
    sessionResult.data.session.access_token;
  if (!accessToken) throw new Error('Your administrator session has expired. Sign in again.');

  const objectPath = createUniqueImagePath(file);
  const endpoint = `${supabaseUrl}/storage/v1/object/${PRODUCT_IMAGE_BUCKET}/${objectPath}`;
  imageUploadProgress.hidden = false;
  imageUploadProgress.value = 0;
  setImageUploadMessage('Uploading image… 0%');

  await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', endpoint);
    request.timeout = 120000;
    request.setRequestHeader('apikey', supabasePublishableKey);
    request.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    request.setRequestHeader('Content-Type', file.type);
    request.setRequestHeader('x-upsert', 'false');
    request.upload.addEventListener('progress', event => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      imageUploadProgress.value = percent;
      setImageUploadMessage(`Uploading image… ${percent}%`);
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }

      let message = `Storage upload failed (HTTP ${request.status}).`;
      try {
        const response = JSON.parse(request.responseText);
        message = response.message || response.error || message;
      } catch {
        message = `Storage upload failed (HTTP ${request.status}).`;
      }
      reject(new Error(message));
    });
    request.addEventListener('error', () => {
      reject(new Error('Could not reach Supabase Storage. Check the network and Storage policies.'));
    });
    request.addEventListener('timeout', () => {
      reject(new Error('Image upload timed out. Check your connection and try again.'));
    });
    request.addEventListener('abort', () => {
      reject(new Error('Image upload was cancelled.'));
    });
    request.send(file);
  });

  imageUploadProgress.value = 100;
  const publicImage = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(objectPath);
  if (!publicImage.data || !publicImage.data.publicUrl) {
    throw new Error('The image uploaded, but Supabase did not return a public URL.');
  }
  setImageUploadMessage('Image uploaded. Saving the product…', 'success');
  return {
    path: objectPath,
    publicUrl: publicImage.data.publicUrl
  };
}

async function removeUploadedProductImage(path) {
  try {
    const result = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
    if (result.error) {
      console.error('New image cleanup failed:', result.error);
      return ` The uploaded image could not be removed: ${result.error.message}`;
    }
    return '';
  } catch (error) {
    console.error('New image cleanup failed:', error);
    return ` The uploaded image could not be removed: ${error.message}`;
  }
}

function formatStock(product) {
  return STOCK_LABELS[product.stock_status] || UNKNOWN_STOCK_LABEL;
}

function createTableCell(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

function showProductTableMessage(message, state = '') {
  productsStatus.textContent = message;
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.className = 'table-empty';
  cell.colSpan = 8;
  cell.textContent = message;
  if (state === 'error') cell.setAttribute('aria-live', 'polite');
  row.appendChild(cell);
  productsBody.replaceChildren(row);
}

function refreshCategories() {
  const selectedCategory = categoryFilter.value;
  categoryFilter.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All categories';
  categoryFilter.appendChild(allOption);

  const categories = [...new Set(
    catalogue
      .map(product => product.category)
      .filter(category => typeof category === 'string' && category.trim())
  )].sort((a, b) => a.localeCompare(b));

  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });
  categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : 'all';
}

function renderProducts() {
  const search = productSearch.value.trim().toLowerCase();
  const category = categoryFilter.value;
  const showingArchived = productArchiveFilter.value === 'archived';
  const statusFiltered = catalogue.filter(product => product.is_archived === showingArchived);
  const filtered = statusFiltered.filter(product => {
    const searchable = [
      product.id,
      product.sku,
      product.title,
      product.category,
      product.description
    ].some(value => String(value || '').toLowerCase().includes(search));
    return searchable && (category === 'all' || product.category === category);
  });

  productsBody.replaceChildren();
  productsStatus.textContent = `${filtered.length} of ${statusFiltered.length} ${showingArchived ? 'archived' : 'active'} products shown`;

  if (filtered.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.className = 'table-empty';
    cell.colSpan = 8;
    cell.textContent = statusFiltered.length
      ? 'No products match this search or category.'
      : showingArchived
        ? 'No products are archived.'
        : 'No active products. Choose Archived products to view archived entries.';
    row.appendChild(cell);
    productsBody.appendChild(row);
    return;
  }

  filtered.forEach(product => {
    const row = document.createElement('tr');
    const productCell = document.createElement('td');
    const productInfo = document.createElement('div');
    productInfo.className = 'product-cell';

    const imagePath = safeImageUrl(product.image_url);
    if (imagePath) {
      const image = document.createElement('img');
      image.src = imagePath;
      image.alt = '';
      image.width = 42;
      image.height = 42;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => image.remove(), { once: true });
      productInfo.appendChild(image);
    }

    const text = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = cellText(product.title, 'Untitled product');
    const identifier = document.createElement('small');
    identifier.textContent = `ID: ${cellText(product.id, 'Not set')}`;
    text.append(title, identifier);
    productInfo.appendChild(text);
    productCell.appendChild(productInfo);

    const categoryCell = createTableCell(cellText(product.category, 'Uncategorised'));
    const unitCell = createTableCell(cellText(product.selling_unit, 'Not configured'));
    const priceCell = createTableCell(
      formatCurrency(product.price)
    );

    const stockCell = document.createElement('td');
    const stockBadge = document.createElement('span');
    stockBadge.className = 'stock-status';
    stockBadge.textContent = formatStock(product);
    stockCell.appendChild(stockBadge);

    const publishCell = document.createElement('td');
    const publishBadge = document.createElement('span');
    publishBadge.className = `publish-badge${product.is_published === true ? ' is-published' : ''}`;
    publishBadge.textContent = product.is_published === true
      ? 'Published'
      : product.is_published === false
        ? 'Not published'
        : 'Not configured';
    publishCell.appendChild(publishBadge);

    const archiveStatusCell = document.createElement('td');
    const archiveStatusBadge = document.createElement('span');
    archiveStatusBadge.className = `archive-status${product.is_archived ? ' is-archived' : ''}`;
    archiveStatusBadge.textContent = product.is_archived ? 'Archived' : 'Active';
    archiveStatusCell.appendChild(archiveStatusBadge);

    const actionsCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'product-actions';
    if (hasPermission('products.manage')) {
      const editButton = document.createElement('button');
      editButton.className = 'edit-button';
      editButton.type = 'button';
      editButton.dataset.editProduct = product.id === null || product.id === undefined
        ? ''
        : String(product.id);
      editButton.textContent = 'Edit';
      editButton.disabled = product.id === null || product.id === undefined;
      editButton.setAttribute('aria-label', `Edit ${cellText(product.title, 'product')}`);
      actions.appendChild(editButton);

      const archiveButton = document.createElement('button');
      archiveButton.type = 'button';
      archiveButton.className = product.is_archived ? 'restore-button' : 'archive-button';
      archiveButton.textContent = product.is_archived ? 'Restore' : 'Archive';
      archiveButton.disabled = !isUuid(product.id) || isUpdatingArchive;
      archiveButton.setAttribute(
        'aria-label',
        `${product.is_archived ? 'Restore' : 'Archive'} ${cellText(product.title, 'product')}`
      );
      if (product.is_archived) {
        archiveButton.dataset.restoreProduct = isUuid(product.id) ? String(product.id) : '';
      } else {
        archiveButton.dataset.archiveProduct = isUuid(product.id) ? String(product.id) : '';
      }
      actions.appendChild(archiveButton);
    }
    actionsCell.appendChild(actions);

    row.append(
      productCell,
      categoryCell,
      unitCell,
      priceCell,
      stockCell,
      publishCell,
      archiveStatusCell,
      actionsCell
    );
    productsBody.appendChild(row);
  });
}

function closeArchiveConfirmation(force = false) {
  if (isUpdatingArchive && !force) return;
  if (typeof archiveConfirmationDialog.close === 'function' && archiveConfirmationDialog.open) {
    archiveConfirmationDialog.close();
  } else {
    archiveConfirmationDialog.removeAttribute('open');
  }
  pendingArchiveAction = null;
  archiveConfirmationMessage.textContent = '';
}

function requestArchiveAction(product, archived) {
  if (!supabase || !administrator || !schemaVerified || !hasPermission('products.manage')) {
    productsStatus.textContent = 'Archive changes require a verified administrator session and products schema.';
    return;
  }
  if (!product || !isUuid(product.id)) {
    productsStatus.textContent = 'This product cannot be changed because its database ID is not a valid UUID.';
    return;
  }
  if (product.is_archived === archived) {
    productsStatus.textContent = `This product is already ${archived ? 'archived' : 'active'}. Refresh the product list and try again.`;
    return;
  }

  pendingArchiveAction = {
    id: String(product.id),
    title: cellText(product.title, 'Untitled product'),
    archived
  };
  archiveConfirmationTitle.textContent = archived ? 'Archive product?' : 'Restore product?';
  archiveConfirmationProductName.textContent = pendingArchiveAction.title;
  archiveConfirmationDescription.textContent = archived
    ? 'Archiving hides this product from the public catalogue. It will not be permanently deleted, and its publication status and product details will remain unchanged.'
    : 'Restoring returns this product to the active products list. Its existing publication status and product details will remain unchanged.';
  archiveConfirmationMessage.textContent = '';
  confirmArchiveButton.textContent = archived ? 'Archive product' : 'Restore product';
  confirmArchiveButton.classList.toggle('restore-confirm-button', !archived);
  if (typeof archiveConfirmationDialog.showModal === 'function') {
    archiveConfirmationDialog.showModal();
  } else {
    archiveConfirmationDialog.setAttribute('open', '');
  }
}

async function confirmArchiveAction() {
  if (isUpdatingArchive || !pendingArchiveAction) return;
  const action = pendingArchiveAction;
  if (!supabase || !administrator || !schemaVerified ||
      !hasPermission('products.manage') || !isUuid(action.id)) {
    archiveConfirmationMessage.textContent = 'This change is unavailable until an authorized administrator session and schema are verified.';
    return;
  }

  const currentProduct = catalogue.find(product => String(product.id) === action.id);
  if (!currentProduct || currentProduct.is_archived === action.archived) {
    archiveConfirmationMessage.textContent = 'This product has changed since the list was loaded. Cancel and refresh the product list before trying again.';
    return;
  }

  isUpdatingArchive = true;
  confirmArchiveButton.disabled = true;
  cancelArchiveButton.disabled = true;
  archiveConfirmationMessage.textContent = action.archived ? 'Archiving product…' : 'Restoring product…';

  try {
    const result = await supabase
      .from('products')
      .update({ is_archived: action.archived })
      .eq('id', action.id)
      .eq('is_archived', !action.archived)
      .select('id,title,is_archived')
      .single();

    if (result.error) throw new Error(result.error.message);
    if (
      !result.data ||
      String(result.data.id).toLowerCase() !== action.id.toLowerCase() ||
      result.data.is_archived !== action.archived
    ) {
      throw new Error('Supabase did not confirm the requested archive state for this product.');
    }

    const successMessage = `${action.title} ${action.archived ? 'archived' : 'restored'}.`;
    pendingArchiveAction = null;
    isUpdatingArchive = false;
    closeArchiveConfirmation(true);
    if (!action.archived) productArchiveFilter.value = 'active';
    const refreshed = await loadProducts();
    productsStatus.textContent = refreshed
      ? successMessage
      : `${successMessage} The product list could not be refreshed; reload the dashboard to see the latest state.`;
  } catch (error) {
    console.error('Product archive update failed:', error);
    archiveConfirmationMessage.textContent =
      `Could not ${action.archived ? 'archive' : 'restore'} ${action.title}: ${error.message}`;
  } finally {
    isUpdatingArchive = false;
    confirmArchiveButton.disabled = false;
    cancelArchiveButton.disabled = false;
  }
}

async function loadProducts() {
  if (!supabase || !administrator) return false;
  if (!hasPermission('products.read')) {
    schemaVerified = false;
    addProductButton.disabled = true;
    productMetric.textContent = '—';
    availabilityMetric.textContent = '—';
    showProductTableMessage('Your administrator role does not include product access.');
    return false;
  }
  schemaVerified = false;
  addProductButton.disabled = true;
  productMetric.textContent = '…';
  showProductTableMessage('Loading products…');
  updateConnectionStatus('Checking product access…');

  try {
    const probe = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .limit(0);
    if (probe.error) {
      console.error('Products schema check failed:', probe.error);
      productMetric.textContent = '—';
      availabilityMetric.textContent = '—';
      updateConnectionStatus('Products schema unavailable', 'error');
      showProductTableMessage(
        `Could not verify the products table fields: ${probe.error.message}. No product writes are enabled.`,
        'error'
      );
      return false;
    }

    const allProducts = [];
    const pageSize = 500;
    let start = 0;
    while (true) {
      const result = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS)
        .order('id', { ascending: true })
        .range(start, start + pageSize - 1);
      if (result.error) {
        console.error('Products could not be loaded:', result.error);
        productMetric.textContent = '—';
        availabilityMetric.textContent = '—';
        updateConnectionStatus('Product read failed', 'error');
        showProductTableMessage(
          `Products could not be loaded: ${result.error.message}. Check the administrator SELECT policy.`,
          'error'
        );
        return false;
      }
      const batch = Array.isArray(result.data) ? result.data : [];
      allProducts.push(...batch);
      if (batch.length < pageSize) break;
      start += pageSize;
    }

    catalogue = allProducts;
    schemaVerified = true;
    addProductButton.disabled = !hasPermission('products.manage');
    const activeProducts = catalogue.filter(product => product.is_archived === false);
    productMetric.textContent = String(activeProducts.length);
    availabilityMetric.textContent = String(
      activeProducts.filter(product => product.stock_status === 'out_of_stock').length
    );
    refreshCategories();
    renderProducts();
    updateConnectionStatus('Authenticated product access ready', 'connected');
    return true;
  } catch (error) {
    console.error('Products request failed:', error);
    productMetric.textContent = '—';
    availabilityMetric.textContent = '—';
    updateConnectionStatus('Product request failed', 'error');
    showProductTableMessage(`Products could not be loaded: ${error.message}`, 'error');
    return false;
  }
}

function settingsValue(key, isPrivate = false) {
  const source = isPrivate ? privateSettings : publicSettings;
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

function setSettingsStatus(message, state = '') {
  settingsStatus.textContent = message;
  settingsStatus.classList.toggle('is-error', state === 'error');
  settingsStatus.classList.toggle('is-success', state === 'success');
}

function availableSettingsCategories() {
  return SETTINGS_CATEGORIES.filter(category =>
    category.mainOnly
      ? adminContext && adminContext.role === 'main'
      : hasPermission(category.permission)
  );
}

function renderSettingsNavigation() {
  const categories = availableSettingsCategories();
  settingsCategories.replaceChildren();
  categories.forEach(category => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-category-button';
    button.classList.toggle('is-active', category.id === activeSettingsCategory);
    button.dataset.settingsCategory = category.id;
    button.textContent = category.title;
    settingsCategories.appendChild(button);
  });

  if (!categories.some(category => category.id === activeSettingsCategory)) {
    activeSettingsCategory = categories.length ? categories[0].id : '';
  }
  if (activeSettingsCategory) renderSettingsCategory(activeSettingsCategory);
  else settingsContent.textContent = 'No settings are assigned to your administrator role.';
}

function appendSettingsNote(parent, message) {
  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent = message;
  parent.appendChild(note);
}

function createSettingsField(field, isPrivate, canEdit) {
  const label = document.createElement('label');
  label.className = `settings-field${field.wide ? ' is-wide' : ''}`;
  label.htmlFor = `setting-${field.key}`;
  label.appendChild(document.createTextNode(field.label));

  let input;
  if (field.type === 'textarea') {
    input = document.createElement('textarea');
  } else if (field.type === 'select') {
    input = document.createElement('select');
    field.options.forEach(([value, name]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = name;
      input.appendChild(option);
    });
  } else {
    input = document.createElement('input');
    input.type = field.type || 'text';
  }

  input.id = `setting-${field.key}`;
  input.name = field.key;
  input.dataset.settingKey = field.key;
  input.value = settingsValue(field.key, isPrivate) ||
    (field.type === 'color' ? '#c9a24d' : '');
  input.disabled = !canEdit;
  if (field.maxLength) input.maxLength = field.maxLength;
  if (field.pattern) input.pattern = field.pattern;
  if (field.required) input.required = true;
  if (field.type === 'url') input.placeholder = 'https://';
  label.appendChild(input);

  if (field.key === 'currency_code') {
    const hint = document.createElement('small');
    hint.textContent = 'The code labels existing amounts; it does not convert them.';
    label.appendChild(hint);
  }
  return label;
}

function renderSettingsCategory(categoryId) {
  const category = SETTINGS_CATEGORIES.find(item => item.id === categoryId);
  if (!category || !availableSettingsCategories().some(item => item.id === categoryId)) return;
  activeSettingsCategory = categoryId;
  settingsCategories.querySelectorAll('[data-settings-category]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.settingsCategory === categoryId);
  });
  settingsContent.replaceChildren();

  const heading = document.createElement('h3');
  heading.textContent = category.title;
  settingsContent.appendChild(heading);

  if (category.information) {
    appendSettingsNote(settingsContent, category.information);
    return;
  }
  if (category.infrastructure) {
    appendSettingsNote(
      settingsContent,
      'No infrastructure operation is exposed from browser code. Database maintenance, credential rotation, backups, Storage policy changes, and security-sensitive actions require separately authorized server-side or Edge Function operations. No service-role key or SQL console is available here.'
    );
    const auditButton = document.createElement('button');
    auditButton.type = 'button';
    auditButton.className = 'button button-secondary';
    auditButton.textContent = 'View security audit log';
    auditButton.addEventListener('click', () => renderSettingsCategory('administration'));
    settingsContent.appendChild(auditButton);
    return;
  }
  if (category.administration) {
    renderAdministratorManagement(settingsContent);
    return;
  }

  const canEdit = hasPermission(category.managePermission);
  const description = document.createElement('p');
  description.className = 'settings-description';
  description.textContent = canEdit
    ? 'Changes are validated and saved to Supabase.'
    : 'This category is read-only for your administrator role.';
  settingsContent.appendChild(description);

  const form = document.createElement('form');
  form.className = 'settings-form';
  form.dataset.settingsCategory = category.id;
  form.dataset.privateSettings = String(Boolean(category.private));
  form.noValidate = false;

  const fields = document.createElement('div');
  fields.className = 'settings-fields';
  category.fields.forEach(field => {
    fields.appendChild(createSettingsField(field, Boolean(category.private), canEdit));
  });
  form.appendChild(fields);

  if (category.note) appendSettingsNote(form, category.note);

  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button button-secondary';
  cancel.textContent = 'Cancel';
  cancel.disabled = !canEdit;
  cancel.addEventListener('click', () => renderSettingsCategory(category.id));
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'button button-primary';
  save.textContent = 'Save settings';
  save.disabled = !canEdit;
  actions.append(cancel, save);
  form.appendChild(actions);
  settingsContent.appendChild(form);
}

async function loadSettingsData({ render = true } = {}) {
  if (!supabase || !administrator || isLoadingSettings) return false;
  isLoadingSettings = true;
  reloadSettingsButton.disabled = true;
  setSettingsStatus('Loading authorized settings…');

  try {
    const publicResult = await supabase
      .from('storefront_settings_public')
      .select('setting_key,setting_value');
    if (publicResult.error) throw new Error(publicResult.error.message);
    publicSettings = Object.fromEntries(
      (publicResult.data || []).map(row => [row.setting_key, row.setting_value])
    );
    const currency = configureCurrency({
      code: publicSettings.currency_code,
      label: publicSettings.currency_label,
      locale: publicSettings.currency_locale
    });
    productPriceHeading.textContent = `Price (${currency.label})`;
    editorCurrencyLabel.textContent = currency.label;

    const privateResult = await supabase
      .from('admin_private_settings')
      .select('setting_key,setting_value')
      .eq('user_id', administrator.id);
    if (privateResult.error) throw new Error(privateResult.error.message);
    privateSettings = Object.fromEntries(
      (privateResult.data || []).map(row => [row.setting_key, row.setting_value])
    );

    if (!privateSettings.dashboard_default_view) {
      privateSettings.dashboard_default_view = 'overview';
    }
    if (!privateSettings.dashboard_product_filter) {
      privateSettings.dashboard_product_filter = 'active';
    }

    if (render) renderSettingsNavigation();
    setSettingsStatus('Settings loaded from Supabase.');
    return true;
  } catch (error) {
    console.error('Settings could not be loaded:', error);
    setSettingsStatus(`Settings could not be loaded: ${error.message}`, 'error');
    return false;
  } finally {
    isLoadingSettings = false;
    reloadSettingsButton.disabled = false;
  }
}

async function saveSettingsForm(event) {
  event.preventDefault();
  const form = event.target.closest('.settings-form');
  if (!form || !form.reportValidity()) return;
  const isPrivate = form.dataset.privateSettings === 'true';
  const values = {};
  form.querySelectorAll('[data-setting-key]').forEach(input => {
    values[input.dataset.settingKey] = input.value.trim();
  });

  const saveButton = form.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  setSettingsStatus('Saving settings…');
  try {
    const result = await supabase.rpc(
      isPrivate ? 'save_admin_preferences' : 'save_storefront_settings',
      { p_settings: values }
    );
    if (result.error) throw new Error(result.error.message);
    const loaded = await loadSettingsData({ render: false });
    if (!loaded) throw new Error('The saved settings could not be reloaded for verification.');
    if (isPrivate && privateSettings.dashboard_product_filter) {
      productArchiveFilter.value = privateSettings.dashboard_product_filter;
      renderProducts();
    }
    renderSettingsCategory(form.dataset.settingsCategory);
    setSettingsStatus('Settings saved and reloaded from Supabase.', 'success');
  } catch (error) {
    console.error('Settings save failed:', error);
    setSettingsStatus(`Settings were not confirmed: ${error.message}`, 'error');
  } finally {
    saveButton.disabled = false;
  }
}

function appendText(parent, tagName, text, className = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

async function renderAdministratorManagement(parent) {
  appendSettingsNote(
    parent,
    'Role and permission changes are enforced by database functions. Use the Auth user UUID, not an email address. A Main Administrator cannot modify their own role or permissions.'
  );

  const roleSection = document.createElement('section');
  roleSection.className = 'admin-role-section';
  appendText(roleSection, 'h4', 'Assign a role');
  const form = document.createElement('form');
  form.className = 'admin-role-form';
  form.id = 'adminRoleForm';

  const userId = document.createElement('input');
  userId.type = 'text';
  userId.name = 'target_user_id';
  userId.placeholder = 'Supabase Auth user UUID';
  userId.pattern = '[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}';
  userId.required = true;
  userId.setAttribute('aria-label', 'Target Auth user UUID');

  const role = document.createElement('select');
  role.name = 'role';
  role.setAttribute('aria-label', 'Administrator role');
  [
    ['operational', 'Operational Administrator'],
    ['privileged', 'Privileged Administrator'],
    ['main', 'Request Main Administrator'],
    ['remove', 'Remove administrator']
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    role.appendChild(option);
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'button button-primary';
  submit.textContent = 'Apply or request';
  form.append(userId, role, submit);
  roleSection.appendChild(form);

  const roster = document.createElement('div');
  roster.className = 'admin-list';
  roster.id = 'administratorRoster';
  roster.textContent = 'Loading administrator assignments…';
  roleSection.appendChild(roster);

  const requestsHeading = appendText(roleSection, 'h4', 'Main Administrator approvals');
  requestsHeading.classList.add('admin-role-section');
  const requests = document.createElement('div');
  requests.className = 'approval-list';
  requests.id = 'administratorRequests';
  requests.textContent = 'Loading pending approvals…';
  roleSection.appendChild(requests);

  parent.appendChild(roleSection);

  const auditSection = document.createElement('section');
  auditSection.className = 'admin-role-section';
  appendText(auditSection, 'h4', 'Sensitive change audit log');
  const audit = document.createElement('div');
  audit.className = 'audit-list';
  audit.id = 'administratorAuditLog';
  audit.textContent = 'Loading audit events…';
  auditSection.appendChild(audit);
  parent.appendChild(auditSection);

  await loadAdministratorGovernance();
}

async function loadAdministratorGovernance() {
  if (!supabase || !adminContext || adminContext.role !== 'main') return;
  const roster = document.getElementById('administratorRoster');
  const requests = document.getElementById('administratorRequests');
  const audit = document.getElementById('administratorAuditLog');
  if (!roster || !requests || !audit) return;

  try {
    const [adminResult, requestResult, auditResult] = await Promise.all([
      supabase.rpc('list_administrators'),
      supabase.rpc('list_admin_role_change_requests'),
      supabase.rpc('get_admin_audit_log', { p_limit: 50 })
    ]);
    if (adminResult.error) throw new Error(adminResult.error.message);
    if (requestResult.error) throw new Error(requestResult.error.message);
    if (auditResult.error) throw new Error(auditResult.error.message);

    renderAdministratorRoster(roster, adminResult.data || []);
    renderRoleChangeRequests(requests, requestResult.data || []);
    renderAuditEntries(audit, auditResult.data || []);
  } catch (error) {
    console.error('Administrator governance data failed to load:', error);
    roster.textContent = `Administrator assignments could not be loaded: ${error.message}`;
    requests.textContent = 'Approval requests are unavailable.';
    audit.textContent = 'Audit events are unavailable.';
  }
}

function renderAdministratorRoster(container, administrators) {
  container.replaceChildren();
  if (!administrators.length) {
    container.textContent = 'No administrator assignments were returned.';
    return;
  }

  administrators.forEach(admin => {
    const entry = document.createElement('article');
    entry.className = 'admin-entry';
    const header = document.createElement('div');
    header.className = 'admin-entry-header';
    appendText(header, 'strong', `${admin.role} administrator`);
    appendText(header, 'small', String(admin.user_id));
    entry.appendChild(header);
    appendText(entry, 'small', admin.is_active ? 'Active' : 'Suspended');

    if (admin.role === 'privileged') {
      const permissionList = document.createElement('div');
      permissionList.className = 'admin-permissions';
      DELEGATABLE_PERMISSIONS.forEach(([permission, label]) => {
        const permissionLabel = document.createElement('label');
        permissionLabel.className = 'admin-permission';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Array.isArray(admin.permissions) &&
          admin.permissions.includes(permission);
        checkbox.dataset.permissionUser = String(admin.user_id);
        checkbox.dataset.permissionKey = permission;
        const text = document.createElement('span');
        text.textContent = label;
        permissionLabel.append(checkbox, text);
        permissionList.appendChild(permissionLabel);
      });
      entry.appendChild(permissionList);
    }

    const protectedIdentity = [
      '6643a7b7-ca7e-4366-b50d-5ba2a84f309a',
      'e8e66900-5025-4ba4-9cb4-b87ecd983c07'
    ].includes(String(admin.user_id).toLowerCase());
    if (
      admin.role !== 'main' &&
      String(admin.user_id).toLowerCase() !== String(administrator.id).toLowerCase() &&
      !protectedIdentity
    ) {
      const statusButton = document.createElement('button');
      statusButton.type = 'button';
      statusButton.className = 'button button-secondary';
      statusButton.textContent = admin.is_active ? 'Suspend administrator' : 'Restore administrator';
      statusButton.dataset.adminStatusUser = String(admin.user_id);
      statusButton.dataset.adminStatusActive = String(!admin.is_active);
      entry.appendChild(statusButton);
    }
    container.appendChild(entry);
  });
}

function renderRoleChangeRequests(container, changeRequests) {
  container.replaceChildren();
  const pending = changeRequests.filter(item => item.status === 'pending');
  if (!pending.length) {
    container.textContent = 'No pending Main Administrator roster changes.';
    return;
  }

  pending.forEach(item => {
    const entry = document.createElement('article');
    entry.className = 'approval-entry';
    const desiredRole = item.requested_role || 'remove';
    const header = document.createElement('div');
    header.className = 'approval-entry-header';
    appendText(header, 'strong', `Request: ${desiredRole}`);
    appendText(header, 'small', `Target UUID: ${item.target_user_id}`);
    entry.appendChild(header);
    appendText(
      entry,
      'small',
      `Requested by ${item.requested_by}; approved by ${(item.approved_by || []).length} of ${(item.required_approver_ids || []).length}.`
    );

    const actionRow = document.createElement('div');
    actionRow.className = 'admin-role-actions';
    const isRequiredApprover = (item.required_approver_ids || []).includes(administrator.id);
    const alreadyApproved = (item.approved_by || []).includes(administrator.id);
    if (isRequiredApprover && !alreadyApproved) {
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'button button-primary';
      approve.textContent = 'Approve roster change';
      approve.dataset.approveRoleRequest = String(item.request_id);
      actionRow.appendChild(approve);
    } else if (!isRequiredApprover) {
      appendText(entry, 'small', 'Only the original Main Administrators may approve this request.');
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button button-secondary';
    cancel.textContent = 'Cancel request';
    cancel.dataset.cancelRoleRequest = String(item.request_id);
    actionRow.appendChild(cancel);
    entry.appendChild(actionRow);
    container.appendChild(entry);
  });
}

function renderAuditEntries(container, events) {
  container.replaceChildren();
  if (!events.length) {
    container.textContent = 'No sensitive changes have been recorded yet.';
    return;
  }
  events.forEach(event => {
    const entry = document.createElement('article');
    entry.className = 'audit-entry';
    appendText(entry, 'strong', event.action);
    appendText(
      entry,
      'small',
      `${new Date(event.occurred_at).toLocaleString()} · Actor: ${event.actor_user_id || 'Migration'}`
    );
    appendText(entry, 'p', `${event.resource_type}${event.resource_id ? ` · ${event.resource_id}` : ''}`);
    if (event.details && Object.keys(event.details).length) {
      appendText(entry, 'small', JSON.stringify(event.details));
    }
    container.appendChild(entry);
  });
}

async function submitAdministratorRole(event) {
  event.preventDefault();
  const form = event.target.closest('#adminRoleForm');
  if (!form || !form.reportValidity()) return;
  const targetId = form.elements.target_user_id.value.trim().toLowerCase();
  const requestedRole = form.elements.role.value;
  if (!isUuid(targetId)) {
    setSettingsStatus('Enter a valid Supabase Auth UUID.', 'error');
    return;
  }
  if (targetId === String(administrator.id).toLowerCase()) {
    setSettingsStatus('You cannot change your own administrator role.', 'error');
    return;
  }

  let rosterResult;
  try {
    rosterResult = await supabase.rpc('list_administrators');
  } catch (error) {
    setSettingsStatus(`Administrator assignments could not be verified: ${error.message}`, 'error');
    return;
  }
  if (rosterResult.error) {
    setSettingsStatus(`Administrator assignments could not be verified: ${rosterResult.error.message}`, 'error');
    return;
  }
  const currentAdmin = Array.isArray(rosterResult.data)
    ? rosterResult.data.find(item => String(item.user_id).toLowerCase() === targetId)
    : null;
  const needsApproval =
    requestedRole === 'main' ||
    Boolean(currentAdmin && currentAdmin.role === 'main') ||
    targetId === '6643a7b7-ca7e-4366-b50d-5ba2a84f309a' ||
    targetId === 'e8e66900-5025-4ba4-9cb4-b87ecd983c07';
  const protectedIdentity = [
    '6643a7b7-ca7e-4366-b50d-5ba2a84f309a',
    'e8e66900-5025-4ba4-9cb4-b87ecd983c07'
  ].includes(targetId);
  const operation = requestedRole === 'remove' ? null : requestedRole;
  const confirmation = protectedIdentity
    ? `The original Main Administrator ${targetId} is immutable through dashboard governance. This attempt will be rejected and logged. Continue?`
    : operation === 'main'
      ? `Request promotion of ${targetId} to Main Administrator. Both original Main Administrators must approve.`
      : needsApproval
        ? `Request a dual-approved change for Main Administrator ${targetId} to ${operation || 'remove access'}? Both original Main Administrators must approve.`
        : `${operation ? `Assign ${operation}` : 'Remove administrator access'} for Auth user ${targetId}?`;
  if (!window.confirm(confirmation)) return;

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    let result;
    if (needsApproval) {
      result = await supabase.rpc('request_admin_role_change', {
        p_target_user_id: targetId,
        p_requested_role: operation
      });
    } else {
      result = await supabase.rpc('set_admin_role', {
        p_target_user_id: targetId,
        p_role: operation
      });
    }
    if (result.error) throw new Error(result.error.message);
    if (needsApproval && !result.data) {
      setSettingsStatus(
        'The database rejected this roster change. The original Main Administrator accounts cannot be changed, and Main appointments require both original administrators to be active.',
        'error'
      );
      await loadAdministratorGovernance();
      return;
    }
    if (!needsApproval && result.data !== true) {
      setSettingsStatus('The database rejected this administrator role change.', 'error');
      await loadAdministratorGovernance();
      return;
    }
    setSettingsStatus(
      needsApproval
        ? `Roster-change request ${result.data} is pending required Main Administrator approvals.`
        : 'Administrator role updated.',
      'success'
    );
    await loadAdministratorGovernance();
  } catch (error) {
    console.error('Administrator role change failed:', error);
    setSettingsStatus(`Administrator role change failed: ${error.message}`, 'error');
  } finally {
    submitButton.disabled = false;
  }
}

async function updateDelegatedPermission(checkbox) {
  if (!checkbox || !adminContext || adminContext.role !== 'main') return;
  const targetId = checkbox.dataset.permissionUser;
  const permission = checkbox.dataset.permissionKey;
  const granted = checkbox.checked;
  if (!window.confirm(
    `${granted ? 'Grant' : 'Revoke'} ${permission} for Privileged Administrator ${targetId}?`
  )) {
    checkbox.checked = !granted;
    return;
  }
  checkbox.disabled = true;
  try {
    const result = await supabase.rpc('set_admin_permission', {
      p_target_user_id: targetId,
      p_permission_key: permission,
      p_granted: granted
    });
    if (result.error) throw new Error(result.error.message);
    if (result.data !== true) {
      throw new Error('The database rejected this protected or unauthorized permission change.');
    }
    setSettingsStatus(
      `${permission} ${granted ? 'granted' : 'revoked'} for ${targetId}.`,
      'success'
    );
    await loadAdministratorGovernance();
  } catch (error) {
    checkbox.checked = !granted;
    console.error('Permission update failed:', error);
    setSettingsStatus(`Permission change failed: ${error.message}`, 'error');
  } finally {
    checkbox.disabled = false;
  }
}

async function updateAdministratorStatus(button) {
  const targetId = button.dataset.adminStatusUser;
  const isActive = button.dataset.adminStatusActive === 'true';
  if (!targetId || !window.confirm(
    `${isActive ? 'Restore' : 'Suspend'} administrator ${targetId}?`
  )) return;
  button.disabled = true;
  try {
    const result = await supabase.rpc('set_admin_status', {
      p_target_user_id: targetId,
      p_is_active: isActive
    });
    if (result.error) throw new Error(result.error.message);
    if (result.data !== true) {
      throw new Error('The database rejected this protected or unauthorized status change.');
    }
    setSettingsStatus(
      `${targetId} ${isActive ? 'restored' : 'suspended'}.`,
      'success'
    );
    await loadAdministratorGovernance();
  } catch (error) {
    console.error('Administrator status update failed:', error);
    setSettingsStatus(`Administrator status update failed: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

async function approveRoleChange(button) {
  const requestId = button.dataset.approveRoleRequest;
  if (!requestId || !window.confirm(`Approve Main Administrator roster-change request ${requestId}?`)) return;
  button.disabled = true;
  try {
    const result = await supabase.rpc('approve_admin_role_change', {
      p_request_id: requestId
    });
    if (result.error) throw new Error(result.error.message);
    let message;
    let status = 'success';
    if (result.data) {
      message = 'The required approvals are complete and the Main Administrator roster change was applied.';
    } else {
      const requestResult = await supabase.rpc('list_admin_role_change_requests');
      if (requestResult.error) throw new Error(requestResult.error.message);
      const request = (requestResult.data || []).find(item => item.request_id === requestId);
      const rejected = Boolean(request && request.status === 'cancelled');
      message = rejected
        ? 'The database rejected and cancelled this request. No Main Administrator status was changed.'
        : 'Your approval is recorded; another original Main Administrator approval is still required.';
      if (rejected) status = 'error';
    }
    setSettingsStatus(message, status);
    await loadAdministratorGovernance();
  } catch (error) {
    console.error('Roster-change approval failed:', error);
    setSettingsStatus(`Roster-change approval failed: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

async function cancelRoleChange(button) {
  const requestId = button.dataset.cancelRoleRequest;
  if (!requestId || !window.confirm(`Cancel pending roster-change request ${requestId}?`)) return;
  button.disabled = true;
  try {
    const result = await supabase.rpc('cancel_admin_role_change', {
      p_request_id: requestId
    });
    if (result.error) throw new Error(result.error.message);
    setSettingsStatus('Roster-change request cancelled.', 'success');
    await loadAdministratorGovernance();
  } catch (error) {
    console.error('Roster-change cancellation failed:', error);
    setSettingsStatus(`Roster-change request could not be cancelled: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

function setEditorValues(product = null) {
  productForm.reset();
  editingProduct = product;
  const source = product || {};
  fields.id.value = cellText(source.id, '');
  fields.id.readOnly = true;
  fields.sku.value = cellText(source.sku, '');
  fields.title.value = cellText(source.title, '');
  fields.category.value = cellText(source.category, '');
  fields.image_url.value = cellText(source.image_url, '');
  resetImageUpload(fields.image_url.value);
  fields.gallery.value = Array.isArray(source.gallery) ? source.gallery.join('\n') : '';
  fields.description.value = cellText(source.description, '');
  fields.selling_unit.value = cellText(source.selling_unit, '');
  fields.price.value = source.price === null || source.price === undefined ? '' : String(source.price);
  fields.minimum_quantity.value = source.minimum_quantity === null || source.minimum_quantity === undefined
    ? ''
    : String(source.minimum_quantity);
  fields.quantity_step.value = source.quantity_step === null || source.quantity_step === undefined
    ? ''
    : String(source.quantity_step);
  fields.stock_status.value = product
    ? Object.prototype.hasOwnProperty.call(STOCK_LABELS, source.stock_status)
      ? source.stock_status
      : ''
    : 'out_of_stock';
  fields.featured.checked = source.featured === true;
  fields.is_published.checked = source.is_published === true;
  showEditorMessage();
  saveProductButton.disabled = !schemaVerified;
}

function openEditor(product = null) {
  if (!schemaVerified) {
    productsStatus.textContent = 'Product writes are disabled until the Supabase products schema is verified.';
    return;
  }
  setEditorValues(product);
  editorTitle.textContent = product ? 'Edit product' : 'Add product';
  if (typeof productEditor.showModal === 'function') productEditor.showModal();
  else productEditor.setAttribute('open', '');
}

function closeEditor(force = false) {
  if (isSavingProduct && !force) return;
  if (typeof productEditor.close === 'function' && productEditor.open) {
    productEditor.close();
  } else {
    productEditor.removeAttribute('open');
  }
  revokeLocalImagePreview();
  productImageFile.value = '';
  imageUploadProgress.hidden = true;
  imageUploadProgress.value = 0;
}

function setEditorBusy(busy) {
  isSavingProduct = busy;
  saveProductButton.disabled = busy || !schemaVerified;
  productImageFile.disabled = busy;
  closeEditorButton.disabled = busy;
  cancelEditorButton.disabled = busy;
}

function readOptionalText(field, existingValue) {
  const value = field.value.trim();
  if (value) return value;
  return existingValue === '' ? '' : null;
}

function parseNumber(field, label, { optional = false, strictlyPositive = false } = {}) {
  const raw = field.value.trim();
  if (optional && raw === '') return null;
  if (raw === '') throw new Error(`${label} is required.`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label} must be a valid number.`);
  if (strictlyPositive ? value <= 0 : value < 0) {
    throw new Error(`${label} must be ${strictlyPositive ? 'greater than zero' : 'zero or greater'}.`);
  }
  return value;
}

function buildProductPayload({ allowMissingImage = false } = {}) {
  const title = fields.title.value.trim();
  const category = fields.category.value.trim();
  const imageUrl = fields.image_url.value.trim();
  const sellingUnit = fields.selling_unit.value.trim();
  if (!title) throw new Error('Product name is required.');
  if (!category) throw new Error('Category is required.');
  if (!imageUrl && !allowMissingImage) {
    throw new Error('Enter an image URL or choose an image file to upload.');
  }
  if (!sellingUnit) throw new Error('Selling unit is required; do not assume one.');
  if (!Object.prototype.hasOwnProperty.call(STOCK_LABELS, fields.stock_status.value)) {
    throw new Error('Choose IN STOCK or OUT OF STOCK.');
  }

  const minimumQuantity = parseNumber(fields.minimum_quantity, 'Minimum quantity');
  const quantityStep = parseNumber(fields.quantity_step, 'Quantity increment', {
    strictlyPositive: true
  });
  const price = parseNumber(fields.price, 'Retail price', { optional: true });
  const galleryPaths = fields.gallery.value
    .split(/\r?\n/)
    .map(path => path.trim())
    .filter(Boolean);
  const previousGallery = editingProduct ? editingProduct.gallery : undefined;
  let gallery = galleryPaths;
  if (!gallery.length) {
    if (!editingProduct) gallery = [];
    else if (previousGallery === null || previousGallery === undefined) gallery = null;
    else gallery = Array.isArray(previousGallery) && previousGallery.length === 0 ? [] : null;
  }

  const payload = {
    sku: readOptionalText(fields.sku, editingProduct ? editingProduct.sku : null),
    title,
    category,
    image_url: imageUrl,
    gallery,
    description: readOptionalText(
      fields.description,
      editingProduct ? editingProduct.description : null
    ),
    featured: fields.featured.checked,
    selling_unit: sellingUnit,
    price,
    minimum_quantity: minimumQuantity,
    quantity_step: quantityStep,
    stock_status: fields.stock_status.value,
    is_published: fields.is_published.checked
  };

  return payload;
}

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

async function saveProduct(event) {
  event.preventDefault();
  if (!supabase || !administrator || !schemaVerified || !hasPermission('products.manage')) {
    showEditorMessage('Product writes are not available until an authorized session and schema are verified.', 'error');
    return;
  }
  if (editingProduct && !isUuid(editingProduct.id)) {
    showEditorMessage('This product cannot be updated because its database ID is not a valid Supabase UUID.', 'error');
    return;
  }

  const imageFile = productImageFile.files && productImageFile.files[0];
  let payload;
  try {
    if (imageFile) {
      validateProductImage(imageFile);
      setImageUploadMessage('Checking image file…');
      await validateProductImageContent(imageFile);
    }
    payload = buildProductPayload({ allowMissingImage: Boolean(imageFile) });
  } catch (error) {
    showEditorMessage(error.message, 'error');
    if (imageFile) setImageUploadMessage(error.message, 'error');
    return;
  }

  if (editingProduct && !imageFile) {
    const changedFields = {};
    Object.entries(payload).forEach(([key, value]) => {
      if (!valuesEqual(editingProduct[key], value)) changedFields[key] = value;
    });
    payload = changedFields;
    if (Object.keys(payload).length === 0) {
      showEditorMessage('No changes to save.');
      return;
    }
  }

  const wasEditing = Boolean(editingProduct);
  let uploadedImage = null;
  setEditorBusy(true);
  try {
    if (imageFile) {
      uploadedImage = await uploadProductImage(imageFile);
      payload.image_url = uploadedImage.publicUrl;
    }

    if (editingProduct) {
      const changedFields = {};
      Object.entries(payload).forEach(([key, value]) => {
        if (!valuesEqual(editingProduct[key], value)) changedFields[key] = value;
      });
      payload = changedFields;
      if (Object.keys(payload).length === 0) {
        const cleanupMessage = uploadedImage
          ? await removeUploadedProductImage(uploadedImage.path)
          : '';
        uploadedImage = null;
        showEditorMessage(`No product fields changed.${cleanupMessage}`);
        return;
      }
    }

    showEditorMessage('Saving product through Supabase…');
    const result = editingProduct
      ? await supabase
        .from('products')
        .update(payload)
        .eq('id', editingProduct.id)
        .select(PRODUCT_COLUMNS)
        .single()
      : await supabase
        .from('products')
        .insert(payload)
        .select(PRODUCT_COLUMNS)
        .single();

    if (result.error) {
      console.error('Product save failed:', result.error);
      const cleanupMessage = uploadedImage
        ? await removeUploadedProductImage(uploadedImage.path)
        : '';
      uploadedImage = null;
      if (imageFile) {
        imageUploadProgress.hidden = true;
        imageUploadProgress.value = 0;
        setImageUploadMessage(
          cleanupMessage
            ? cleanupMessage.trim()
            : 'Product save failed. The new image upload was cleaned up.',
          'error'
        );
      }
      showEditorMessage(
        `Product was not saved: ${result.error.message}. Confirm the schema and administrator write policies.${cleanupMessage}`,
        'error'
      );
      return;
    }

    const savedTitle = cellText(result.data && result.data.title, 'Product');
    closeEditor(true);
    const refreshed = await loadProducts();
    if (refreshed) {
      productsStatus.textContent = `${savedTitle} ${wasEditing ? 'updated' : 'created'}${imageFile ? ' with its image uploaded' : ''}.`;
    }
  } catch (error) {
    console.error('Product save request failed:', error);
    let cleanupMessage = '';
    if (uploadedImage) {
      cleanupMessage = await removeUploadedProductImage(uploadedImage.path);
      uploadedImage = null;
    }
    if (imageFile) {
      imageUploadProgress.hidden = true;
      imageUploadProgress.value = 0;
      setImageUploadMessage(
        cleanupMessage
          ? cleanupMessage.trim()
          : error.message,
        'error'
      );
    }
    showEditorMessage(`Product was not saved: ${error.message}${cleanupMessage}`, 'error');
  } finally {
    setEditorBusy(false);
  }
}

async function verifyAdministrator(user) {
  showAuthState('checking', 'Verifying administrator access…');
  let result;
  try {
    result = await supabase.rpc('is_admin');
  } catch (error) {
    console.error('Administrator verification request failed:', error);
    showAuthState('error', `Could not verify administrator access: ${error.message}`);
    return false;
  }
  if (result.error) {
    console.error('Administrator verification failed:', result.error);
    showAuthState(
      'error',
      `Could not verify administrator access: ${result.error.message}. Confirm public.is_admin() and its authenticated-user permissions.`
    );
    return false;
  }
  if (result.data !== true) {
    try {
      const signOutResult = await supabase.auth.signOut({ scope: 'local' });
      if (signOutResult.error) {
        console.error('Unauthorized session could not be cleared:', signOutResult.error);
      }
    } catch (error) {
      console.error('Unauthorized session could not be cleared:', error);
    }
    showAuthState('unauthorized', 'This account is not recognized as an administrator. Sign in with an authorized account.');
    return false;
  }

  let contextResult;
  try {
    contextResult = await supabase.rpc('get_admin_context');
  } catch (error) {
    console.error('Administrator role context request failed:', error);
    showAuthState('error', `Could not load database-enforced administrator permissions: ${error.message}`);
    return false;
  }
  if (contextResult.error) {
    console.error('Administrator role context failed:', contextResult.error);
    showAuthState(
      'error',
      `The role-management migration must be reviewed and applied before using this dashboard: ${contextResult.error.message}`
    );
    return false;
  }
  const context = contextResult.data;
  if (
    !context ||
    context.user_id !== user.id ||
    !['main', 'privileged', 'operational'].includes(context.role)
  ) {
    administrator = null;
    adminContext = null;
    showAuthState('unauthorized', 'This account has no active administrator role.');
    return false;
  }

  administrator = user;
  adminContext = context;
  authGate.hidden = true;
  dashboardApp.hidden = false;
  adminIdentity.textContent = `${user && user.email ? user.email : 'Administrator'} · ${context.role}`;
  renderNavigationAccess();
  productArchiveFilter.value = 'active';
  await loadSettingsData();
  const savedFilter = privateSettings.dashboard_product_filter;
  if (savedFilter === 'active' || savedFilter === 'archived') {
    productArchiveFilter.value = savedFilter;
  }
  if (hasPermission('products.read')) await loadProducts();
  showView(
    privateSettings.dashboard_default_view === 'products' && hasPermission('products.read')
      ? 'products'
      : 'overview'
  );
  return true;
}

async function restoreSession() {
  if (!supabase) return;
  showAuthState('checking', 'Checking the saved administrator session…');
  let result;
  try {
    result = await supabase.auth.getSession();
  } catch (error) {
    console.error('Saved session request failed:', error);
    showAuthState('error', `Could not check the saved session: ${error.message}`);
    return;
  }
  if (result.error) {
    console.error('Saved session could not be checked:', result.error);
    showAuthState('error', `Could not check the saved session: ${result.error.message}`);
    return;
  }
  const session = result.data && result.data.session;
  if (!session || !session.user) {
    administrator = null;
    showAuthState('login', 'Sign in with an authorized Supabase administrator account.');
    return;
  }
  await verifyAdministrator(session.user);
}

async function initializeSupabase() {
  showAuthState('checking', 'Loading secure dashboard configuration…');
  updateConnectionStatus('Not configured');

  let configResponse;
  try {
    configResponse = await fetch('./supabase-config.js', {
      method: 'HEAD',
      cache: 'no-store'
    });
  } catch {
    showAuthState(
      'configuration',
      'Could not check the local Supabase configuration. Copy admin/supabase-config.example.js to admin/supabase-config.js and reload.'
    );
    return;
  }
  if (!configResponse.ok) {
    showAuthState(
      'configuration',
      'Supabase is not configured in this checkout. Copy admin/supabase-config.example.js to admin/supabase-config.js, add the Project URL and publishable/anon key, then reload. Never use a service-role key.'
    );
    return;
  }

  let configModule;
  try {
    configModule = await import('./supabase-config.js');
  } catch {
    showAuthState(
      'error',
      'The local Supabase configuration could not be loaded. Check admin/supabase-config.js for valid JavaScript exports and reload.'
    );
    return;
  }

  const config = validateConfiguration(configModule);
  if (config.error) {
    showAuthState('configuration', config.error);
    return;
  }

  supabaseUrl = config.url;
  supabasePublishableKey = config.key;

  let createClient;
  try {
    ({ createClient } = await import(SUPABASE_SDK_URL));
  } catch {
    showAuthState('error', 'The pinned Supabase JavaScript client could not be loaded. Check the network/CDN access and retry.');
    return;
  }

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
    showAuthState('error', `Supabase client could not be initialized: ${error.message}`);
    return;
  }

  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') {
      administrator = null;
      adminContext = null;
      catalogue = [];
      schemaVerified = false;
      publicSettings = {};
      privateSettings = {};
      renderNavigationAccess();
      dashboardApp.hidden = true;
      updateConnectionStatus('Signed out');
      showAuthState('login', 'You have been signed out.');
    }
  });

  await restoreSession();
}

navigationButtons.forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

settingsCategories.addEventListener('click', event => {
  const button = event.target.closest('[data-settings-category]');
  if (button) renderSettingsCategory(button.dataset.settingsCategory);
});
settingsContent.addEventListener('submit', event => {
  if (event.target.matches('.settings-form')) {
    saveSettingsForm(event);
  } else if (event.target.matches('#adminRoleForm')) {
    submitAdministratorRole(event);
  }
});
settingsContent.addEventListener('change', event => {
  if (event.target.matches('[data-permission-user][data-permission-key]')) {
    updateDelegatedPermission(event.target);
  }
});
settingsContent.addEventListener('click', event => {
  const statusButton = event.target.closest('[data-admin-status-user]');
  if (statusButton) {
    updateAdministratorStatus(statusButton);
    return;
  }
  const approveButton = event.target.closest('[data-approve-role-request]');
  if (approveButton) {
    approveRoleChange(approveButton);
    return;
  }
  const cancelButton = event.target.closest('[data-cancel-role-request]');
  if (cancelButton) cancelRoleChange(cancelButton);
});
reloadSettingsButton.addEventListener('click', () => loadSettingsData());

productSearch.addEventListener('input', renderProducts);
categoryFilter.addEventListener('change', renderProducts);
productArchiveFilter.addEventListener('change', renderProducts);
addProductButton.addEventListener('click', () => openEditor());
productsBody.addEventListener('click', event => {
  const archiveButton = event.target.closest('[data-archive-product], [data-restore-product]');
  if (archiveButton) {
    const productId = archiveButton.dataset.archiveProduct || archiveButton.dataset.restoreProduct;
    const product = catalogue.find(item => String(item.id) === productId);
    if (product) requestArchiveAction(product, archiveButton.hasAttribute('data-archive-product'));
    return;
  }
  const editButton = event.target.closest('[data-edit-product]');
  if (!editButton) return;
  const product = catalogue.find(item => String(item.id) === editButton.dataset.editProduct);
  if (product) openEditor(product);
});
confirmArchiveButton.addEventListener('click', confirmArchiveAction);
cancelArchiveButton.addEventListener('click', closeArchiveConfirmation);
archiveConfirmationDialog.addEventListener('cancel', event => {
  if (isUpdatingArchive) event.preventDefault();
  else pendingArchiveAction = null;
});
archiveConfirmationDialog.addEventListener('click', event => {
  if (event.target === archiveConfirmationDialog) closeArchiveConfirmation();
});
document.getElementById('closeEditorButton').addEventListener('click', closeEditor);
document.getElementById('cancelEditorButton').addEventListener('click', closeEditor);
productImageFile.addEventListener('change', handleProductImageSelection);
fields.image_url.addEventListener('input', () => {
  if (!productImageFile.files || productImageFile.files.length === 0) {
    showImagePreview(fields.image_url.value.trim(), 'Current product image');
  }
});
productEditor.addEventListener('click', event => {
  if (event.target === productEditor) closeEditor();
});
productEditor.addEventListener('cancel', event => {
  if (isSavingProduct) event.preventDefault();
});
productForm.addEventListener('submit', saveProduct);

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase) return;
  loginButton.disabled = true;
  authMessage.textContent = 'Signing in…';
  authMessage.classList.remove('is-error');
  try {
    const result = await supabase.auth.signInWithPassword({
      email: document.getElementById('loginEmail').value.trim(),
      password: document.getElementById('loginPassword').value
    });
    if (result.error) {
      authMessage.textContent = `Sign-in failed: ${result.error.message}`;
      authMessage.classList.add('is-error');
      return;
    }
    document.getElementById('loginPassword').value = '';
    if (!result.data || !result.data.user) {
      showAuthState('error', 'Supabase did not return an authenticated user. Try again.');
      return;
    }
    await verifyAdministrator(result.data.user);
  } catch (error) {
    console.error('Sign-in request failed:', error);
    authMessage.textContent = `Sign-in failed: ${error.message}`;
    authMessage.classList.add('is-error');
  } finally {
    loginButton.disabled = false;
  }
});

document.getElementById('forgotPasswordButton').addEventListener('click', () => {
  recoveryEmail.value = document.getElementById('loginEmail').value.trim();
  showAuthState(
    'recovery',
    'Enter the administrator email address to receive a secure password reset link.'
  );
  recoveryEmail.focus();
});

document.getElementById('backToLoginButton').addEventListener('click', () => {
  showAuthState('login', 'Sign in with an authorized Supabase administrator account.');
  document.getElementById('loginEmail').focus();
});

recoveryForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase) return;

  const email = recoveryEmail.value.trim();
  if (!email) {
    authMessage.textContent = 'Enter the administrator email address.';
    authMessage.classList.add('is-error');
    recoveryEmail.focus();
    return;
  }

  sendRecoveryButton.disabled = true;
  authMessage.textContent = 'Sending password recovery email…';
  authMessage.classList.remove('is-error');
  try {
    const redirectUrl = new URL('/admin/reset-password.html', window.location.origin).href;
    const result = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl
    });
    if (result.error) {
      console.error('Password recovery request failed:', result.error);
      authMessage.textContent = `Recovery email could not be sent: ${result.error.message}`;
      authMessage.classList.add('is-error');
      return;
    }
    authMessage.textContent =
      'If an account exists for that email, a password recovery link has been sent. Check the inbox and spam folder.';
  } catch (error) {
    console.error('Password recovery request failed:', error);
    authMessage.textContent = `Recovery email could not be sent: ${error.message}`;
    authMessage.classList.add('is-error');
  } finally {
    sendRecoveryButton.disabled = false;
  }
});

retryAuthButton.addEventListener('click', () => {
  if (supabase) restoreSession();
  else initializeSupabase();
});
document.getElementById('logoutButton').addEventListener('click', async () => {
  if (!supabase) return;
  administrator = null;
  dashboardApp.hidden = true;
  updateConnectionStatus('Signing out…');
  try {
    const result = await supabase.auth.signOut({ scope: 'local' });
    if (result.error) {
      console.error('Sign-out failed:', result.error);
      showAuthState('error', `Sign-out failed: ${result.error.message}`);
      return;
    }
  } catch (error) {
    console.error('Sign-out failed:', error);
    showAuthState('error', `Sign-out failed: ${error.message}`);
    return;
  }
  showAuthState('login', 'You have been signed out.');
});

initializeSupabase();
