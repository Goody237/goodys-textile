GOODYS TEXTILE WEBSITE V2
==========================

This version is deliberately built for MANUAL EDITING after publication.

EDITING:
After deployment and CMS authentication are configured, visit:
https://YOUR-SITE.netlify.app/admin/

You will get a visual dashboard where you can:
- Edit the website settings (brand text, phone, WhatsApp, location, hero text).
- Add/edit/remove fabric catalogue entries.
- Upload/select product images.
- Change availability/status.
- Change the WhatsApp enquiry message.

The CMS saves changes to the site's repository; the hosting service then republishes the updated files.

FREE PUBLISHING PLAN:
Recommended architecture:
- GitHub Free = repository
- Netlify = free hosting + free netlify.app address
- Decap CMS = free/open-source editing interface
- URL will be something like: goodystextile.netlify.app (subject to availability)
A custom .com domain is NOT included and would normally require a paid domain registration.

IMPORTANT:
The package includes the CMS files, but live CMS login cannot be activated until the site is connected to a Git repository/hosting account. That is an account-level setup, not something that should be done with passwords inside this package.

CURRENT CONTENT:
Only the real supplied fabric/store images are used. No fabric prices have been invented. Product availability is marked to confirm current stock.

NEXT:
1. Upload this package to a GitHub repository.
2. Connect the repository to Netlify.
3. Enable Netlify Identity + Git Gateway for Decap CMS.
4. Set the site name to Goodys Textile / a suitable free netlify.app subdomain.
5. Invite/enable your admin account.
6. Test editing one product before public launch.
