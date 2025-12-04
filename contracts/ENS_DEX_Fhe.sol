pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ENSDEXFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Order {
        euint32 encryptedENSId;
        euint32 encryptedPrice;
        euint32 encryptedAmount;
        bool isBid;
    }
    mapping(uint256 => Order) public orders;
    uint256 public nextOrderId;

    struct Batch {
        uint256 id;
        uint256 createdAt;
        bool closed;
    }
    mapping(uint256 => Batch) public batches;
    uint256 public currentBatchId;
    uint256 public nextBatchId;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error InvalidBatch();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PausedContract();
    event UnpausedContract();
    event CooldownSecondsChanged(uint256 oldCooldown, uint256 newCooldown);
    event OrderSubmitted(address indexed provider, uint256 indexed batchId, uint256 indexed orderId, bool isBid);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        nextBatchId = 1;
        nextOrderId = 1;
        cooldownSeconds = 10; // Default cooldown
        emit ProviderAdded(owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit PausedContract();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit UnpausedContract();
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsChanged(oldCooldown, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId = nextBatchId++;
        batches[currentBatchId] = Batch(currentBatchId, block.timestamp, false);
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (currentBatchId == 0 || batches[currentBatchId].closed) revert InvalidBatch();
        batches[currentBatchId].closed = true;
        emit BatchClosed(currentBatchId);
    }

    function submitOrder(
        euint32 encryptedENSId,
        euint32 encryptedPrice,
        euint32 encryptedAmount,
        bool isBid
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        _initIfNeeded(encryptedENSId);
        _initIfNeeded(encryptedPrice);
        _initIfNeeded(encryptedAmount);

        if (currentBatchId == 0 || batches[currentBatchId].closed) revert InvalidBatch();

        uint256 orderId = nextOrderId++;
        orders[orderId] = Order(encryptedENSId, encryptedPrice, encryptedAmount, isBid);
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit OrderSubmitted(msg.sender, currentBatchId, orderId, isBid);
    }

    function requestBatchDecryption(uint256 batchId) external onlyOwner whenNotPaused checkDecryptionCooldown {
        if (batchId == 0 || !batches[batchId].closed) revert InvalidBatch();

        // 1. Prepare Ciphertexts: For this example, we'll decrypt the sum of all bid prices and ask prices.
        // This is a simplified example. A real DEX would need more complex matching logic.
        euint32 memory encryptedTotalBidPrice = FHE.asEuint32(0);
        euint32 memory encryptedTotalAskPrice = FHE.asEuint32(0);
        bool initializedBidSum = false;
        bool initializedAskSum = false;

        for (uint256 i = 1; i < nextOrderId; i++) {
            if (orders[i].encryptedPrice.isInitialized()) {
                if (orders[i].isBid) {
                    if (!initializedBidSum) {
                        encryptedTotalBidPrice = orders[i].encryptedPrice;
                        initializedBidSum = true;
                    } else {
                        encryptedTotalBidPrice = encryptedTotalBidPrice.add(orders[i].encryptedPrice);
                    }
                } else {
                    if (!initializedAskSum) {
                        encryptedTotalAskPrice = orders[i].encryptedPrice;
                        initializedAskSum = true;
                    } else {
                        encryptedTotalAskPrice = encryptedTotalAskPrice.add(orders[i].encryptedPrice);
                    }
                }
            }
        }
         // If no bids or asks, use a default initialized value (e.g., 0)
        if (!encryptedTotalBidPrice.isInitialized()) encryptedTotalBidPrice = FHE.asEuint32(0);
        if (!encryptedTotalAskPrice.isInitialized()) encryptedTotalAskPrice = FHE.asEuint32(0);


        bytes32[] memory cts = new bytes32[](2);
        cts[0] = encryptedTotalBidPrice.toBytes32();
        cts[1] = encryptedTotalAskPrice.toBytes32();

        // 2. Compute State Hash
        bytes32 stateHash = _hashCiphertexts(cts);

        // 3. Request Decryption
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        // 4. Store Context
        decryptionContexts[requestId] = DecryptionContext(batchId, stateHash, false);
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        // a. Replay Guard
        if (decryptionContexts[requestId].processed) revert ReplayDetected();

        // b. State Verification
        // Rebuild cts array from current contract storage in the *exact same order* as in requestBatchDecryption
        euint32 memory currentEncryptedTotalBidPrice = FHE.asEuint32(0);
        euint32 memory currentEncryptedTotalAskPrice = FHE.asEuint32(0);
        bool initializedBidSumCurrent = false;
        bool initializedAskSumCurrent = false;

        for (uint256 i = 1; i < nextOrderId; i++) {
            if (orders[i].encryptedPrice.isInitialized()) {
                if (orders[i].isBid) {
                    if (!initializedBidSumCurrent) {
                        currentEncryptedTotalBidPrice = orders[i].encryptedPrice;
                        initializedBidSumCurrent = true;
                    } else {
                        currentEncryptedTotalBidPrice = currentEncryptedTotalBidPrice.add(orders[i].encryptedPrice);
                    }
                } else {
                    if (!initializedAskSumCurrent) {
                        currentEncryptedTotalAskPrice = orders[i].encryptedPrice;
                        initializedAskSumCurrent = true;
                    } else {
                        currentEncryptedTotalAskPrice = currentEncryptedTotalAskPrice.add(orders[i].encryptedPrice);
                    }
                }
            }
        }
        if (!currentEncryptedTotalBidPrice.isInitialized()) currentEncryptedTotalBidPrice = FHE.asEuint32(0);
        if (!currentEncryptedTotalAskPrice.isInitialized()) currentEncryptedTotalAskPrice = FHE.asEuint32(0);

        bytes32[] memory currentCts = new bytes32[](2);
        currentCts[0] = currentEncryptedTotalBidPrice.toBytes32();
        currentCts[1] = currentEncryptedTotalAskPrice.toBytes32();

        bytes32 currentHash = _hashCiphertexts(currentCts);
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        // c. Proof Verification
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        // d. Decode & Finalize
        // For this example, we just confirm decryption. Actual use would process cleartexts.
        // uint32 totalBidPrice = abi.decode(cleartexts[0], (uint32)); // Example
        // uint32 totalAskPrice = abi.decode(cleartexts[1], (uint32)); // Example

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 memory val) internal pure {
        if (!val.isInitialized()) {
            // This is a placeholder. In a real scenario, you'd ensure initialization
            // or handle uninitialized values appropriately based on FHE library specifics.
            // For this example, we assume FHE.asEuint32(0) is used if not initialized where needed.
        }
    }

    // This function is a simplified example of how one might ensure an euint32 is initialized
    // if the FHE library requires it for certain operations, or to provide a default.
    // The actual FHE library might have its own mechanisms.
    // For this contract, we use FHE.asEuint32(0) as a fallback when summing uninitialized values.
    // The _initIfNeeded function above is a no-op in this simplified example.
}