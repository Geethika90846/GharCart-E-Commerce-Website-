# GharCart – Full-Stack E-commerce Prototype (User + Admin Modules)

GharCart is a modern online store built with Node.js, Express, SQLite, and EJS, designed for hassle-free shopping with 100% Cash-on-Delivery (COD). It features a full customer purchasing flow and a comprehensive store administration dashboard.

---

## 🔑 Demo Credentials

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@shopsphere.com` | `Admin@123` |
| **Demo Customer** | `user@shopsphere.com` | `User@123` |

*Quick 1-click auto-fill buttons are also provided on both the Customer Login (`/login`) and Admin Portal Login (`/admin/login`) screens.*

---

## 🚀 Key Features

### 🛒 Customer Module
1. **User Authentication & Session Management**:
   - Register with validation (name, email, phone, password confirmation).
   - Session-based cookie auth with bcrypt password hashing.
   - Redirect rules protecting user and admin views.
2. **Catalog & Dashboard (`/dashboard`)**:
   - Live product search bar with query highlight.
   - Category filter chips (Electronics, Fashion, Home, etc.).
   - Sort dropdown (Price: Low to High, High to Low, Highest Rated).
   - Responsive product cards with hover zoom and rating stars.
   - Low-stock badge ("Only 3 left!") and Out-of-Stock handling.
   - Instant "Add to Cart" with animated badge pop and toasts.
3. **Specific Product Page (`/product/:id`)**:
   - High-resolution product images and thumbnail preview.
   - Interactive quantity stepper (- / +).
   - "Add to Cart" and instant "Buy Now (COD)".
   - Related products recommendation section.
4. **Shopping Cart (`/cart`)**:
   - Persistent per-user cart stored in SQLite.
   - Real-time quantity adjustments and remove items without page reload.
   - Dynamic order summary with free delivery eligibility calculation (₹40, free over ₹999).
5. **Checkout & Delivery Details (`/checkout`)**:
   - Recipient address form (name, phone, street address, city, 6-digit pincode).
   - Automatically pre-filled from user profile or past orders.
6. **Cash-on-Delivery Payment (`/payment`)**:
   - Dedicated COD confirmation with zero upfront payment risk.
7. **Order Placement (`POST /place-order`)**:
   - SQLite atomic transaction verifying stock availability.
   - Automatically decrements product inventory.
   - Clears customer cart and sends in-app notification.
8. **Order Success (`/order-success/:id`)**:
   - Animated SVG checkmark.
   - Estimated 3–5 days delivery schedule and summary.
9. **Order Tracking (`/orders`)**:
   - Comprehensive history with color-coded status badges (Placed, Shipped, Delivered, Cancelled).
10. **In-App Notification Bell**:
    - Unread indicator badge and dropdown with real-time updates.

---

### 🛡️ Admin Module
1. **Role-Protected Admin Portal (`/admin/login`)**.
2. **Interactive Dashboard (`/admin/dashboard`)**:
   - 4 live stat cards: Total Products, Customers, Orders, Gross Revenue in ₹.
   - 3 quick-action tiles: Add Product, View Customers, Manage Orders.
   - Recent orders mini-table.
   - Inventory table with Edit and Delete controls.
3. **Add & Edit Product (`/admin/add-product`, `/admin/edit-product/:id`)**:
   - Add new items with title, price, category, stock, description.
   - Live image preview updates instantly as image URL is pasted.
4. **Order Management (`/admin/orders`)**:
   - Filter orders by status chips (All, Placed, Shipped, Delivered, Cancelled).
   - AJAX status dropdown: instantly updates status, changes badge styling, and creates a real-time notification for the customer.
5. **Customer Directory (`/admin/customers`)**:
   - Live customer search by name, email, or phone.
   - Metrics showing order count and total customer lifetime spend.

---

## 🛠️ Tech Stack

- **Backend**: Node.js + Express.js
- **Database**: SQLite (via `sql.js` WebAssembly + `shop.db` disk persistence)
- **Session & Security**: `express-session`, `bcryptjs`, `express-validator`
- **Frontend Views**: Server-rendered EJS templates
- **Styling**: Tailwind CSS + Google Fonts "Inter"
- **Icons**: Lucide Icons
- **Theme**: Persistent Dark / Light mode toggle
- **Currency**: Indian Rupee (`₹`), formatted with `toLocaleString('en-IN')`
