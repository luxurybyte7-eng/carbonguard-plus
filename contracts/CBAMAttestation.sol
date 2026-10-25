// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CBAM Attestation Registry - verifiable embedded-emissions records for EU CBAM exports
/// @notice An Indian exporter's emissions data is checked off-chain by the AI verifier. Only a salted
///         hash commitment of the data (never the raw data) is stored on chain, with the result.
///         An EU importer / auditor can look up an attestation by ID and, if the exporter shares the
///         data + salt, re-derive the commitment to prove the numbers were not changed afterwards.
contract CBAMAttestation {
    struct Attestation {
        bytes32 commitment;        // sha256(salt || canonical(data)), "zk-ready" commitment
        bytes32 exporterId;        // keccak256 of exporter identifier (e.g. IEC / EORI)
        string cnCode;             // EU Combined Nomenclature code, e.g. 7208 (flat-rolled steel)
        uint16 year; uint8 quarter;
        uint256 tonnesProduct;     // tonnes of goods covered
        uint256 embeddedKgCO2PerT; // verified embedded emissions intensity (kgCO2e per tonne)
        uint8 riskScore;           // 0-100 AI anomaly score
        address verifier; uint64 timestamp; bool revoked;
    }
    address public admin; uint8 public maxRiskScore = 40;
    mapping(address => bool) public verifiers;
    mapping(bytes32 => Attestation) private _att;   // id => attestation
    mapping(bytes32 => bool) public usedCommitment;
    bytes32[] public ids;

    event Attested(bytes32 indexed id, bytes32 indexed exporterId, string cnCode, uint16 year, uint8 quarter, uint256 embeddedKgCO2PerT, uint8 riskScore);
    event Revoked(bytes32 indexed id, string reason);
    error NotAdmin(); error NotVerifier(); error RiskTooHigh(uint8 score); error DuplicateCommitment(); error Unknown(); error BadInput();

    error ZeroAddress();
    constructor(address verifier) { if (verifier == address(0)) revert ZeroAddress(); admin = msg.sender; verifiers[verifier] = true; } // admin and AI-oracle verifier are separate keys
    function setVerifier(address v, bool ok) external { if (msg.sender != admin) revert NotAdmin(); verifiers[v] = ok; }

    function attest(bytes32 commitment, bytes32 exporterId, string calldata cnCode, uint16 year, uint8 quarter,
                    uint256 tonnesProduct, uint256 embeddedKgCO2PerT, uint8 riskScore) external returns (bytes32 id) {
        if (!verifiers[msg.sender]) revert NotVerifier();
        if (riskScore > 100 || quarter == 0 || quarter > 4 || tonnesProduct == 0) revert BadInput();
        if (riskScore > maxRiskScore) revert RiskTooHigh(riskScore);
        if (usedCommitment[commitment]) revert DuplicateCommitment();
        usedCommitment[commitment] = true;
        id = keccak256(abi.encodePacked(block.chainid, address(this), commitment));
        _att[id] = Attestation(commitment, exporterId, cnCode, year, quarter, tonnesProduct, embeddedKgCO2PerT, riskScore, msg.sender, uint64(block.timestamp), false);
        ids.push(id);
        emit Attested(id, exporterId, cnCode, year, quarter, embeddedKgCO2PerT, riskScore);
    }
    function revoke(bytes32 id, string calldata reason) external {
        if (!verifiers[msg.sender]) revert NotVerifier(); if (_att[id].timestamp == 0) revert Unknown();
        _att[id].revoked = true; emit Revoked(id, reason);
    }
    function get(bytes32 id) external view returns (Attestation memory a) { a = _att[id]; if (a.timestamp == 0) revert Unknown(); }
    /// @notice True if the attestation exists, is not revoked, and matches the commitment re-derived from disclosed data.
    function verify(bytes32 id, bytes32 commitment) external view returns (bool) {
        Attestation storage a = _att[id]; return a.timestamp != 0 && !a.revoked && a.commitment == commitment;
    }
    function count() external view returns (uint256) { return ids.length; }
}
