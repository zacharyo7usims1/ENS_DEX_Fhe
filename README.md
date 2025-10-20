# ENS Privacy DEX: A FHE-based Limit Order Book for Exotic NFTs

The ENS Privacy DEX is a revolutionary decentralized exchange specifically designed for trading exotic and non-visual functional NFTs, such as ENS domains. This platform utilizes **Zama's Fully Homomorphic Encryption (FHE) technology** to protect the order books and pricing strategies of buyers and sellers, ensuring secure and confidential interactions in the NFT marketplace.

## Why This Project Matters

The NFT market has grown exponentially, but with this growth comes significant challenges. Traditional NFT exchanges can expose sensitive pricing strategies and market data, leading to potential exploitation and lack of privacy for users. Buyers and sellers often hesitate to engage fully in the marketplace due to the transparency of their transactions, which can yield competitive disadvantages or even market manipulation.

## How FHE Solves This Problem

**Zama's Fully Homomorphic Encryption technology** enables the processing of encrypted data without needing to decrypt it. By implementing Zama's open-source libraries, such as **Concrete** and the **zama-fhe SDK**, we ensure that all transactions and pricing strategies remain confidential. This means that users can place limit orders, negotiate prices, and interact without fear of exposing their data to the public or malicious actors. The result is a marketplace that enhances privacy and fosters confidence among its users.

## Core Functionalities

- **Limit Order FHE Encryption:** Allows users to place limit orders securely while keeping their bid and ask prices confidential.
- **Batch Private Pricing:** Supports bulk pricing requests, enabling users to negotiate multiple orders at once without revealing individual figures.
- **Liquidity and Privacy Solutions:** Addresses liquidity challenges for non-fungible assets, providing a robust infrastructure for specific NFT markets while maintaining users' privacy.
- **Professional and Efficient Exchange Style:** Features a clean and user-friendly interface tailored to enhance user experience while navigating through functional NFTs.

## Technology Stack

- **Zama FHE SDK**: The backbone of our confidential computing capabilities.
- **Node.js**: For backend development and server-side operations.
- **Hardhat/Foundry**: Smart contract development and testing framework.
- **Solidity**: Primary programming language for writing smart contracts.

## Directory Structure

Here's a snapshot of the project directory structure:

```
ENS_DEX_Fhe/
│
├── contracts/
│   └── ENS_DEX_Fhe.sol
│
├── src/
│   ├── index.js
│   ├── utils.js
│   └── config.js
│
├── tests/
│   ├── ENS_DEX_Fhe.test.js
│   └── utils.test.js
│
├── package.json
└── hardhat.config.js
```

## Setting Up the Project

To get started with the ENS Privacy DEX, follow these steps to install the necessary dependencies and set up your environment:

1. **Ensure you have Node.js installed** on your machine. You can download it from the official Node.js website.
2. **Navigate to the project directory** where you downloaded the files.
3. Run the following command to install the required dependencies, including Zama FHE libraries:
   ```bash
   npm install
   ```

> **Important:** Do not use `git clone` or any URLs to download this repository. Download the files manually instead to ensure proper setup.

## Building and Running the Project

Once the installation is complete, you can compile and run the ENS Privacy DEX using the following commands:

### Compile the Smart Contracts
To compile the smart contracts, execute:
```bash
npx hardhat compile
```

### Run Tests
To ensure everything works correctly, run the tests:
```bash
npx hardhat test
```

### Start the Development Environment
You can launch the local development environment by running:
```bash
npx hardhat run scripts/deploy.js
```

## Example Code Snippet

Here's a simple example demonstrating how to create a limit order on the ENS Privacy DEX using our smart contracts:

```javascript
const { ethers } = require("hardhat");

async function placeLimitOrder(tokenId, price) {
    const [owner] = await ethers.getSigners();
    const ensDex = await ethers.getContractAt("ENS_DEX_Fhe", "contract_address_here");

    const encryptedPrice = await encryptPrice(price); // Placeholder for FHE encryption
  
    const tx = await ensDex.placeLimitOrder(tokenId, encryptedPrice);
    await tx.wait();
    console.log(`Limit Order placed for tokenId: ${tokenId} at price: ${encryptedPrice}`);
}

// Dummy function to represent price encryption, to be replaced with actual FHE functionality
async function encryptPrice(price) {
    // Implement actual FHE encryption logic here
    return price; // For demonstration purposes, returning plain price
}

// Call the function to place an order (example usage)
placeLimitOrder("ENS Domain Example", 0.5);
```

## Acknowledgements

### Powered by Zama

We extend our heartfelt gratitude to the Zama team for their pioneering work in fully homomorphic encryption and the open-source tools they provide. Their contributions are instrumental in making secure and confidential blockchain applications a reality, allowing us to create innovative solutions like the ENS Privacy DEX.