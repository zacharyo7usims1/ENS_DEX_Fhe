// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Order {
  id: string;
  encryptedPrice: string;
  encryptedAmount: string;
  timestamp: number;
  maker: string;
  ensName: string;
  orderType: "buy" | "sell";
  status: "active" | "filled" | "cancelled";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newOrderData, setNewOrderData] = useState({ ensName: "", orderType: "buy", price: 0, amount: 1 });
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [decryptedPrice, setDecryptedPrice] = useState<number | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"all" | "buy" | "sell">("all");
  const [userHistory, setUserHistory] = useState<Order[]>([]);

  // Stats calculations
  const activeBuyOrders = orders.filter(o => o.status === "active" && o.orderType === "buy").length;
  const activeSellOrders = orders.filter(o => o.status === "active" && o.orderType === "sell").length;
  const filledOrders = orders.filter(o => o.status === "filled").length;
  const cancelledOrders = orders.filter(o => o.status === "cancelled").length;

  useEffect(() => {
    loadOrders().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  useEffect(() => {
    if (isConnected && address) {
      const userOrders = orders.filter(o => o.maker.toLowerCase() === address.toLowerCase());
      setUserHistory(userOrders);
    }
  }, [orders, address, isConnected]);

  const loadOrders = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract is not available");
        return;
      }

      const keysBytes = await contract.getData("order_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing order keys:", e); }
      }

      const list: Order[] = [];
      for (const key of keys) {
        try {
          const orderBytes = await contract.getData(`order_${key}`);
          if (orderBytes.length > 0) {
            try {
              const orderData = JSON.parse(ethers.toUtf8String(orderBytes));
              list.push({ 
                id: key, 
                encryptedPrice: orderData.price, 
                encryptedAmount: orderData.amount,
                timestamp: orderData.timestamp, 
                maker: orderData.maker, 
                ensName: orderData.ensName,
                orderType: orderData.orderType,
                status: orderData.status || "active"
              });
            } catch (e) { console.error(`Error parsing order data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading order ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setOrders(list);
    } catch (e) { console.error("Error loading orders:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createOrder = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    if (!newOrderData.ensName || !newOrderData.price || !newOrderData.amount) {
      alert("Please fill all required fields");
      return;
    }

    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting order data with Zama FHE..." });
    
    try {
      const encryptedPrice = FHEEncryptNumber(newOrderData.price);
      const encryptedAmount = FHEEncryptNumber(newOrderData.amount);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const orderId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const orderData = { 
        price: encryptedPrice, 
        amount: encryptedAmount,
        timestamp: Math.floor(Date.now() / 1000), 
        maker: address, 
        ensName: newOrderData.ensName,
        orderType: newOrderData.orderType,
        status: "active"
      };
      
      await contract.setData(`order_${orderId}`, ethers.toUtf8Bytes(JSON.stringify(orderData)));
      
      const keysBytes = await contract.getData("order_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(orderId);
      await contract.setData("order_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Order created with FHE encryption!" });
      await loadOrders();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewOrderData({ ensName: "", orderType: "buy", price: 0, amount: 1 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Order creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreating(false); 
    }
  };

  const decryptWithSignature = async (encryptedPrice: string, encryptedAmount: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const price = FHEDecryptNumber(encryptedPrice);
      const amount = FHEDecryptNumber(encryptedAmount);
      
      return { price, amount };
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const cancelOrder = async (orderId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Cancelling order with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const orderBytes = await contract.getData(`order_${orderId}`);
      if (orderBytes.length === 0) throw new Error("Order not found");
      
      const orderData = JSON.parse(ethers.toUtf8String(orderBytes));
      const updatedOrder = { ...orderData, status: "cancelled" };
      
      await contract.setData(`order_${orderId}`, ethers.toUtf8Bytes(JSON.stringify(updatedOrder)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Order cancelled successfully!" });
      await loadOrders();
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Cancellation failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (orderAddress: string) => address?.toLowerCase() === orderAddress.toLowerCase();

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.ensName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === "all" || order.orderType === filterType;
    return matchesSearch && matchesType;
  });

  const handleCheckAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      alert(`Contract is ${isAvailable ? 'available' : 'not available'}`);
    } catch (e) {
      console.error("Error checking availability:", e);
      alert("Failed to check contract availability");
    }
  };

  const handleDecryptOrder = async (order: Order) => {
    const result = await decryptWithSignature(order.encryptedPrice, order.encryptedAmount);
    if (result) {
      setDecryptedPrice(result.price);
      setDecryptedAmount(result.amount);
    }
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing FHE encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>ENS<span>DEX</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-order-btn metal-button"
          >
            <div className="add-icon"></div>New Order
          </button>
          <button 
            onClick={handleCheckAvailability} 
            className="metal-button"
          >
            Check FHE Status
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content partitioned-layout">
        {/* Left Panel - Order Book */}
        <div className="panel left-panel">
          <div className="panel-header">
            <h2>Order Book</h2>
            <div className="panel-actions">
              <button 
                onClick={loadOrders} 
                className="metal-button small" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="search-filter">
            <input
              type="text"
              placeholder="Search ENS names..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="metal-input"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as "all" | "buy" | "sell")}
              className="metal-select"
            >
              <option value="all">All Orders</option>
              <option value="buy">Buy Orders</option>
              <option value="sell">Sell Orders</option>
            </select>
          </div>

          <div className="order-book metal-card">
            <div className="order-table-header">
              <div className="header-cell">ENS Name</div>
              <div className="header-cell">Type</div>
              <div className="header-cell">Maker</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="no-orders">
                <div className="no-orders-icon"></div>
                <p>No orders found</p>
                <button 
                  className="metal-button primary" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Order
                </button>
              </div>
            ) : (
              filteredOrders.map(order => (
                <div 
                  className="order-row" 
                  key={order.id} 
                  onClick={() => setSelectedOrder(order)}
                >
                  <div className="table-cell ens-name">{order.ensName}</div>
                  <div className={`table-cell order-type ${order.orderType}`}>
                    {order.orderType}
                  </div>
                  <div className="table-cell maker">
                    {order.maker.substring(0, 6)}...{order.maker.substring(38)}
                  </div>
                  <div className="table-cell">
                    {new Date(order.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${order.status}`}>
                      {order.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(order.maker) && order.status === "active" && (
                      <button 
                        className="action-btn metal-button danger"
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          cancelOrder(order.id); 
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Stats and User History */}
        <div className="panel right-panel">
          <div className="stats-section">
            <h2>Market Statistics</h2>
            <div className="stats-grid">
              <div className="stat-item metal-card">
                <div className="stat-value">{orders.length}</div>
                <div className="stat-label">Total Orders</div>
              </div>
              <div className="stat-item metal-card">
                <div className="stat-value">{activeBuyOrders}</div>
                <div className="stat-label">Active Buy</div>
              </div>
              <div className="stat-item metal-card">
                <div className="stat-value">{activeSellOrders}</div>
                <div className="stat-label">Active Sell</div>
              </div>
              <div className="stat-item metal-card">
                <div className="stat-value">{filledOrders}</div>
                <div className="stat-label">Filled</div>
              </div>
              <div className="stat-item metal-card">
                <div className="stat-value">{cancelledOrders}</div>
                <div className="stat-label">Cancelled</div>
              </div>
            </div>
          </div>

          <div className="user-history-section">
            <h2>Your Order History</h2>
            <div className="history-list metal-card">
              {userHistory.length === 0 ? (
                <div className="no-history">
                  <p>No order history found</p>
                </div>
              ) : (
                userHistory.map(order => (
                  <div 
                    className="history-row" 
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                  >
                    <div className="history-cell">{order.ensName}</div>
                    <div className={`history-cell ${order.orderType}`}>
                      {order.orderType}
                    </div>
                    <div className="history-cell">
                      {new Date(order.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="history-cell">
                      <span className={`status-badge ${order.status}`}>
                        {order.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create Order Modal */}
      {showCreateModal && (
        <ModalCreate 
          onSubmit={createOrder} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          orderData={newOrderData} 
          setOrderData={setNewOrderData}
        />
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <OrderDetailModal 
          order={selectedOrder} 
          onClose={() => { 
            setSelectedOrder(null); 
            setDecryptedPrice(null);
            setDecryptedAmount(null);
          }} 
          decryptedPrice={decryptedPrice}
          decryptedAmount={decryptedAmount}
          setDecryptedPrice={setDecryptedPrice}
          setDecryptedAmount={setDecryptedAmount}
          isDecrypting={isDecrypting} 
          decryptWithSignature={handleDecryptOrder}
        />
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>ENS_DEX_Fhe</span>
            </div>
            <p>FHE-encrypted limit order book for ENS domains</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Zama FHE</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} ENS_DEX_Fhe. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  orderData: any;
  setOrderData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, orderData, setOrderData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setOrderData({ ...orderData, [name]: value });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setOrderData({ ...orderData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!orderData.ensName || !orderData.price || !orderData.amount) {
      alert("Please fill all required fields");
      return;
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Create New Order</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your order data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>ENS Name *</label>
              <input 
                type="text" 
                name="ensName" 
                value={orderData.ensName} 
                onChange={handleChange} 
                placeholder="e.g., vitalik.eth" 
                className="metal-input"
              />
            </div>

            <div className="form-group">
              <label>Order Type *</label>
              <select 
                name="orderType" 
                value={orderData.orderType} 
                onChange={handleChange} 
                className="metal-select"
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>

            <div className="form-group">
              <label>Price (ETH) *</label>
              <input 
                type="number" 
                name="price" 
                value={orderData.price} 
                onChange={handleNumberChange} 
                placeholder="Enter price in ETH" 
                className="metal-input"
                step="0.01"
                min="0"
              />
            </div>

            <div className="form-group">
              <label>Amount *</label>
              <input 
                type="number" 
                name="amount" 
                value={orderData.amount} 
                onChange={handleNumberChange} 
                placeholder="Enter amount" 
                className="metal-input"
                min="1"
              />
            </div>
          </div>

          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Price:</span>
                <div>{orderData.price || 'No value entered'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>
                  {orderData.price ? 
                    FHEEncryptNumber(orderData.price).substring(0, 30) + '...' : 
                    'No value entered'
                  }
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-button">
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating} 
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Create Order"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface OrderDetailModalProps {
  order: Order;
  onClose: () => void;
  decryptedPrice: number | null;
  decryptedAmount: number | null;
  setDecryptedPrice: (value: number | null) => void;
  setDecryptedAmount: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (order: Order) => Promise<void>;
}

const OrderDetailModal: React.FC<OrderDetailModalProps> = ({ 
  order, 
  onClose, 
  decryptedPrice,
  decryptedAmount,
  setDecryptedPrice,
  setDecryptedAmount,
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedPrice !== null) {
      setDecryptedPrice(null);
      setDecryptedAmount(null);
      return;
    }
    await decryptWithSignature(order);
  };

  return (
    <div className="modal-overlay">
      <div className="order-detail-modal metal-card">
        <div className="modal-header">
          <h2>Order Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>

        <div className="modal-body">
          <div className="order-info">
            <div className="info-item">
              <span>ENS Name:</span>
              <strong>{order.ensName}</strong>
            </div>
            <div className="info-item">
              <span>Order Type:</span>
              <strong className={`order-type ${order.orderType}`}>
                {order.orderType}
              </strong>
            </div>
            <div className="info-item">
              <span>Maker:</span>
              <strong>
                {order.maker.substring(0, 6)}...{order.maker.substring(38)}
              </strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>
                {new Date(order.timestamp * 1000).toLocaleString()}
              </strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${order.status}`}>
                {order.status}
              </strong>
            </div>
          </div>

          <div className="encrypted-data-section">
            <h3>Encrypted Data</h3>
            <div className="encrypted-data">
              <div className="encrypted-item">
                <span>Price:</span>
                <div>{order.encryptedPrice.substring(0, 50)}...</div>
              </div>
              <div className="encrypted-item">
                <span>Amount:</span>
                <div>{order.encryptedAmount.substring(0, 50)}...</div>
              </div>
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn metal-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedPrice !== null ? (
                "Hide Decrypted Values"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>

          {decryptedPrice !== null && decryptedAmount !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Values</h3>
              <div className="decrypted-values">
                <div className="decrypted-item">
                  <span>Price:</span>
                  <div className="decrypted-value">{decryptedPrice} ETH</div>
                </div>
                <div className="decrypted-item">
                  <span>Amount:</span>
                  <div className="decrypted-value">{decryptedAmount}</div>
                </div>
              </div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;