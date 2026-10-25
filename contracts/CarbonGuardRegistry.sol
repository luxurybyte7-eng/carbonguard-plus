// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CarbonGuard Registry - AI-verified carbon credits with on-chain double-counting prevention
/// @notice Each credit batch is bound to a unique (registry, serial) pair AND a unique MRV data hash.
///         An AI verifier oracle must attest a risk score before issuance; high-risk batches are blocked.
///         Retirement is final and records the beneficiary, so a credit can never be claimed twice.
contract CarbonGuardRegistry {
    struct Batch {
        bytes32 projectId;     // keccak of project identifier
        uint16 vintage;        // year of emission reduction
        uint256 amount;        // tonnes CO2e
        uint256 retired;       // tonnes retired
        bytes32 mrvHash;       // hash of measurement/reporting/verification dataset
        uint8 riskScore;       // 0-100 from AI verifier
        address owner;
        bool exists;
    }

    address public admin;
    uint8 public maxRiskScore = 40;
    mapping(address => bool) public verifiers;   // AI oracle signers
    mapping(address => bool) public issuers;     // project developers / registries

    mapping(bytes32 => Batch) public batches;            // batchId => Batch
    mapping(bytes32 => bool) public usedSerial;          // keccak(registry, serial) used?
    mapping(bytes32 => bool) public usedMrv;             // MRV data hash used?
    mapping(bytes32 => uint8) public attestedRisk;       // termsHash(mrvHash, projectId, amount, vintage, chainid) => risk+1 (0 = none)
    mapping(bytes32 => mapping(address => uint256)) public balanceOf; // batchId => holder => tonnes
    bytes32[] public batchIds;

    event VerifierSet(address v, bool ok);
    event IssuerSet(address i, bool ok);
    event Attested(bytes32 indexed mrvHash, bytes32 termsHash, uint256 amount, uint8 riskScore, string reportURI);
    event Issued(bytes32 indexed batchId, bytes32 projectId, uint16 vintage, uint256 amount, bytes32 mrvHash, uint8 riskScore);
    event Transferred(bytes32 indexed batchId, address from, address to, uint256 amount);
    event Retired(bytes32 indexed batchId, address holder, uint256 amount, string beneficiary, string reason);

    error NotAdmin(); error NotVerifier(); error NotIssuer();
    error DuplicateSerial(); error DuplicateMrvData(); error NotAttested(); error RiskTooHigh(uint8 score);
    error AlreadyAttested(); error ZeroAddress(); error UnknownBatch(); error InsufficientBalance(); error BadAmount(); error BadScore();

    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }

    /// @notice Roles are separate keys: admin (governance only), AI-oracle verifier, project issuer.
    ///         The admin is NOT automatically a verifier or issuer (least privilege).
    constructor(address verifier, address issuer) {
        if (verifier == address(0) || issuer == address(0)) revert ZeroAddress();
        admin = msg.sender; verifiers[verifier] = true; issuers[issuer] = true;
        emit VerifierSet(verifier, true); emit IssuerSet(issuer, true);
    }

    /// @notice The exact terms an AI approval covers. Changing amount, project or vintage => different hash => NotAttested.
    function termsHash(bytes32 mrvHash, bytes32 projectId, uint256 amount, uint16 vintage) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), mrvHash, projectId, amount, vintage));
    }

    function setVerifier(address v, bool ok) external onlyAdmin { verifiers[v] = ok; emit VerifierSet(v, ok); }
    function setIssuer(address i, bool ok) external onlyAdmin { issuers[i] = ok; emit IssuerSet(i, ok); }
    function setMaxRiskScore(uint8 s) external onlyAdmin { if (s > 100) revert BadScore(); maxRiskScore = s; }

    /// @notice AI verifier posts its risk score for an MRV dataset (report stored off-chain, e.g. IPFS).
    ///         The approval is bound to (mrvHash, projectId, amount, vintage, chain, contract) and cannot be overwritten.
    function attest(bytes32 mrvHash, bytes32 projectId, uint256 amount, uint16 vintage, uint8 riskScore, string calldata reportURI) external {
        if (!verifiers[msg.sender]) revert NotVerifier();
        if (riskScore > 100) revert BadScore();
        bytes32 t = termsHash(mrvHash, projectId, amount, vintage);
        if (attestedRisk[t] != 0) revert AlreadyAttested();
        attestedRisk[t] = riskScore + 1;
        emit Attested(mrvHash, t, amount, riskScore, reportURI);
    }

    function issue(bytes32 projectId, string calldata registry, string calldata serial, uint16 vintage, uint256 amount, bytes32 mrvHash)
        external returns (bytes32 batchId)
    {
        if (!issuers[msg.sender]) revert NotIssuer();
        if (amount == 0) revert BadAmount();
        bytes32 serialKey = keccak256(abi.encode(registry, serial)); // abi.encode: no packed-string collisions
        if (usedSerial[serialKey]) revert DuplicateSerial();
        if (usedMrv[mrvHash]) revert DuplicateMrvData();
        uint8 r = attestedRisk[termsHash(mrvHash, projectId, amount, vintage)];
        if (r == 0) revert NotAttested();
        uint8 score = r - 1;
        if (score > maxRiskScore) revert RiskTooHigh(score);

        usedSerial[serialKey] = true;
        usedMrv[mrvHash] = true;
        batchId = keccak256(abi.encode(serialKey, mrvHash));
        batches[batchId] = Batch(projectId, vintage, amount, 0, mrvHash, score, msg.sender, true);
        balanceOf[batchId][msg.sender] = amount;
        batchIds.push(batchId);
        emit Issued(batchId, projectId, vintage, amount, mrvHash, score);
    }

    function transfer(bytes32 batchId, address to, uint256 amount) external {
        if (!batches[batchId].exists) revert UnknownBatch();
        if (amount == 0) revert BadAmount();
        if (balanceOf[batchId][msg.sender] < amount) revert InsufficientBalance();
        balanceOf[batchId][msg.sender] -= amount;
        balanceOf[batchId][to] += amount;
        emit Transferred(batchId, msg.sender, to, amount);
    }

    /// @notice Permanently retire (burn) credits for a named beneficiary. Cannot be undone or re-sold.
    function retire(bytes32 batchId, uint256 amount, string calldata beneficiary, string calldata reason) external {
        Batch storage b = batches[batchId];
        if (!b.exists) revert UnknownBatch();
        if (amount == 0) revert BadAmount();
        if (balanceOf[batchId][msg.sender] < amount) revert InsufficientBalance();
        balanceOf[batchId][msg.sender] -= amount;
        b.retired += amount;
        emit Retired(batchId, msg.sender, amount, beneficiary, reason);
    }

    function batchCount() external view returns (uint256) { return batchIds.length; }
}
