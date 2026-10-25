// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EpochPilotRouter
 * @notice Non-custodial Dual-Voter Batch Router & MUSD Bribe Compounder for Mezo Earn (tigris).
 * @dev Designed for Mezo Mainnet (31612) & Matsnet Testnet (31611).
 *      Allows a single veMEZO NFT to atomically allocate:
 *        1) 100% of Voting Budget #1 across BoostVoter gauges (veBTC boost market)
 *        2) 100% of Voting Budget #2 across ThirdPartyVoter gauges (Curve/Uniswap/Aero MUSD pools)
 *        3) Claim anti-dilution MEZO rebases via RewardsDistributor
 *        4) Permissionlessly poke target veBTC boosts & staking gauges
 *        5) Claim multi-gauge ERC-20 bribes and route them into MUSD or sMUSD (MUSDSavingsRate)
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

interface IVotingEscrow {
    function ownerOf(uint256 tokenId) external view returns (address);
    function isApprovedOrOwner(address spender, uint256 tokenId) external view returns (bool);
}

interface IMezoVoter {
    function vote(
        uint256 _tokenId,
        address[] calldata _poolOrGaugeVote,
        uint256[] calldata _weights
    ) external;

    function reset(uint256 _tokenId) external;

    function poke(uint256 _tokenId) external;

    function claimBribes(
        address[] calldata _bribes,
        address[][] calldata _tokens,
        uint256 _tokenId
    ) external;
}

interface IBoostVoter is IMezoVoter {
    function pokeBoost(uint256 _veBtcTokenId) external;
    function pokeBoosts(uint256[] calldata _veBtcTokenIds) external;
    function getBoost(uint256 _veBtcTokenId) external view returns (uint256);
    function addBribes(address _gauge, address[] calldata _tokens, uint256[] calldata _amounts) external;
}

interface IRewardsDistributor {
    function claim(uint256 _tokenId) external returns (uint256);
}

interface IBribeVotingReward {
    function getReward(uint256 tokenId, address[] calldata tokens) external;
    function notifyRewardAmount(address token, uint256 amount) external;
}

interface ITigrisRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IERC4626 {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
}

contract EpochPilotRouter {
    error NotAuthorizedForToken(uint256 tokenId);
    error ArrayLengthMismatch();
    error ZeroAddress();
    error ZeroAmount();
    error ReentrancyGuardReentrantCall();
    error SafeERC20FailedOperation(address token);
    error SlippageToleranceExceeded(uint256 amountOut, uint256 minOut);

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    IVotingEscrow public immutable veMEZO;
    IVotingEscrow public immutable veBTC;
    IBoostVoter public immutable boostVoter;
    IMezoVoter public immutable thirdPartyVoter;
    IMezoVoter public immutable poolsVoter;
    IRewardsDistributor public immutable veMezoRebaseDistributor;
    ITigrisRouter public immutable dexRouter;
    address public immutable defaultFactory;
    address public immutable musd;
    address public immutable sMusd;

    event DualEpochVoteExecuted(
        address indexed voter,
        uint256 indexed veMezoTokenId,
        uint256 boostGaugeCount,
        uint256 thirdPartyGaugeCount,
        uint256 rebaseClaimed
    );

    event BribesCompoundedToMUSD(
        address indexed owner,
        uint256 indexed tokenId,
        uint256 totalMusdOut,
        bool stakedInSMusd
    );

    event CrossPairBribePosted(
        address indexed sponsor,
        address indexed bribeContract,
        address indexed rewardToken,
        uint256 amount,
        uint256 pokedVeBtcId
    );

    constructor(
        address _veMEZO,
        address _veBTC,
        address _boostVoter,
        address _thirdPartyVoter,
        address _poolsVoter,
        address _veMezoRebaseDistributor,
        address _dexRouter,
        address _defaultFactory,
        address _musd,
        address _sMusd
    ) {
        if (_veMEZO == address(0) || _boostVoter == address(0) || _thirdPartyVoter == address(0)) {
            revert ZeroAddress();
        }
        veMEZO = IVotingEscrow(_veMEZO);
        veBTC = IVotingEscrow(_veBTC);
        boostVoter = IBoostVoter(_boostVoter);
        thirdPartyVoter = IMezoVoter(_thirdPartyVoter);
        poolsVoter = IMezoVoter(_poolsVoter);
        veMezoRebaseDistributor = IRewardsDistributor(_veMezoRebaseDistributor);
        dexRouter = ITigrisRouter(_dexRouter);
        defaultFactory = _defaultFactory;
        musd = _musd;
        sMusd = _sMusd;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyTokenOperator(IVotingEscrow escrow, uint256 tokenId) {
        if (!escrow.isApprovedOrOwner(msg.sender, tokenId)) {
            revert NotAuthorizedForToken(tokenId);
        }
        _;
    }

    function _callOptionalReturn(address token, bytes memory data) private {
        (bool success, bytes memory returndata) = token.call(data);
        if (!success || (returndata.length != 0 && !abi.decode(returndata, (bool)))) {
            revert SafeERC20FailedOperation(token);
        }
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        _callOptionalReturn(token, abi.encodeCall(IERC20.transfer, (to, value)));
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        _callOptionalReturn(token, abi.encodeCall(IERC20.transferFrom, (from, to, value)));
    }

    function _forceApprove(address token, address spender, uint256 value) private {
        bytes memory approvalCall = abi.encodeCall(IERC20.approve, (spender, value));
        (bool success, bytes memory returndata) = token.call(approvalCall);
        if (!success || (returndata.length != 0 && !abi.decode(returndata, (bool)))) {
            _callOptionalReturn(token, abi.encodeCall(IERC20.approve, (spender, 0)));
            _callOptionalReturn(token, approvalCall);
        }
    }

    /**
     * @notice Executes both independent 100% veMEZO voting budgets in a single transaction,
     *         claims weekly veMEZO anti-dilution rebases, and optionally pokes target veBTC boosts.
     * @dev Requires caller to be owner/approved of `veMezoTokenId` AND this router to be approved on `veMEZO`.
     */
    function executeOptimalEpochVote(
        uint256 veMezoTokenId,
        address[] calldata boostTargets,
        uint256[] calldata boostWeights,
        address[] calldata thirdPartyGauges,
        uint256[] calldata thirdPartyWeights,
        uint256[] calldata veBtcIdsToPokeBoost,
        bool claimRebase
    ) external nonReentrant onlyTokenOperator(veMEZO, veMezoTokenId) {
        if (
            boostTargets.length != boostWeights.length ||
            thirdPartyGauges.length != thirdPartyWeights.length
        ) {
            revert ArrayLengthMismatch();
        }

        uint256 rebaseClaimed = 0;
        if (claimRebase && address(veMezoRebaseDistributor) != address(0)) {
            try veMezoRebaseDistributor.claim(veMezoTokenId) returns (uint256 amount) {
                rebaseClaimed = amount;
            } catch {}
        }

        if (boostTargets.length > 0) {
            boostVoter.vote(veMezoTokenId, boostTargets, boostWeights);
        }

        if (thirdPartyGauges.length > 0) {
            thirdPartyVoter.vote(veMezoTokenId, thirdPartyGauges, thirdPartyWeights);
        }

        if (veBtcIdsToPokeBoost.length > 0) {
            boostVoter.pokeBoosts(veBtcIdsToPokeBoost);
        }

        emit DualEpochVoteExecuted(
            msg.sender,
            veMezoTokenId,
            boostTargets.length,
            thirdPartyGauges.length,
            rebaseClaimed
        );
    }

    /**
     * @notice Claims ERC-20 bribes across multiple BribeVotingReward contracts for `veMezoTokenId`,
     *         swaps specified reward tokens into MUSD via Mezo's Tigris Router, and optionally
     *         stakes resulting MUSD into sMUSD (MUSDSavingsRate).
     * @dev Note: BribeVotingReward.getReward transfers tokens to veMEZO.ownerOf(veMezoTokenId).
     *      The owner approves this router for the non-MUSD tokens they wish to auto-swap into MUSD.
     *      All output MUSD or sMUSD shares are unconditionally credited to `nftOwner`.
     */
    function claimAndCompoundToMUSD(
        uint256 veMezoTokenId,
        address[] calldata bribeContracts,
        address[][] calldata bribeTokens,
        address[] calldata tokensToSwap,
        uint256[] calldata minMusdOuts,
        bool[] calldata useStablePool,
        bool stakeIntoSMusd
    ) external nonReentrant onlyTokenOperator(veMEZO, veMezoTokenId) returns (uint256 totalMusdOut) {
        if (
            bribeContracts.length != bribeTokens.length ||
            tokensToSwap.length != minMusdOuts.length ||
            tokensToSwap.length != useStablePool.length
        ) {
            revert ArrayLengthMismatch();
        }

        address nftOwner = veMEZO.ownerOf(veMezoTokenId);
        if (nftOwner == address(0)) {
            revert ZeroAddress();
        }

        for (uint256 i = 0; i < bribeContracts.length; i++) {
            if (bribeContracts[i] == address(0)) revert ZeroAddress();
            IBribeVotingReward(bribeContracts[i]).getReward(veMezoTokenId, bribeTokens[i]);
        }

        address recipient = (stakeIntoSMusd && sMusd != address(0)) ? address(this) : nftOwner;
        for (uint256 i = 0; i < tokensToSwap.length; i++) {
            totalMusdOut += _swapTokenToMusd(
                nftOwner,
                tokensToSwap[i],
                minMusdOuts[i],
                useStablePool[i],
                recipient
            );
        }

        if (stakeIntoSMusd && sMusd != address(0) && totalMusdOut > 0) {
            _forceApprove(musd, sMusd, totalMusdOut);
            IERC4626(sMusd).deposit(totalMusdOut, nftOwner);
            _forceApprove(musd, sMusd, 0);

            // Sweep any residual MUSD dust back to the verified NFT owner
            uint256 musdDust = IERC20(musd).balanceOf(address(this));
            if (musdDust > 0) {
                _safeTransfer(musd, nftOwner, musdDust);
            }
        }

        emit BribesCompoundedToMUSD(nftOwner, veMezoTokenId, totalMusdOut, stakeIntoSMusd);
    }

    function _swapTokenToMusd(
        address nftOwner,
        address tokenIn,
        uint256 minOut,
        bool stablePool,
        address recipient
    ) internal returns (uint256) {
        if (tokenIn == address(0) || tokenIn == musd) return 0;
        uint256 amountIn = IERC20(tokenIn).balanceOf(nftOwner);
        if (amountIn == 0) return 0;

        _safeTransferFrom(tokenIn, nftOwner, address(this), amountIn);
        _forceApprove(tokenIn, address(dexRouter), amountIn);

        ITigrisRouter.Route[] memory routes = new ITigrisRouter.Route[](1);
        routes[0] = ITigrisRouter.Route({
            from: tokenIn,
            to: musd,
            stable: stablePool,
            factory: defaultFactory
        });

        uint256[] memory amounts = dexRouter.swapExactTokensForTokens(
            amountIn,
            minOut,
            routes,
            recipient,
            block.timestamp + 600
        );
        _forceApprove(tokenIn, address(dexRouter), 0);

        uint256 actualOut = amounts[amounts.length - 1];
        if (actualOut < minOut) {
            revert SlippageToleranceExceeded(actualOut, minOut);
        }

        // Sweep any unspent input token dust back to nftOwner
        uint256 remainingIn = IERC20(tokenIn).balanceOf(address(this));
        if (remainingIn > 0) {
            _safeTransfer(tokenIn, nftOwner, remainingIn);
        }

        return actualOut;
    }

    /**
     * @notice Cross-Pair Arbitrage Helper: Posts an MUSD or MEZO bribe on a veBTC Boost Gauge's
     *         BribeVotingReward contract and pokes the veBTC boost in one transaction.
     */
    function postCrossPairBribeAndPoke(
        address gauge,
        address rewardToken,
        uint256 amount,
        uint256 veBtcTokenId,
        bool pokePoolsVoter
    ) external nonReentrant {
        if (gauge == address(0) || rewardToken == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        _safeTransferFrom(rewardToken, msg.sender, address(this), amount);
        _forceApprove(rewardToken, address(boostVoter), amount);

        address[] memory tokens = new address[](1);
        tokens[0] = rewardToken;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        boostVoter.addBribes(gauge, tokens, amounts);
        _forceApprove(rewardToken, address(boostVoter), 0);

        // Return any unconsumed reward token dust to sponsor
        uint256 leftover = IERC20(rewardToken).balanceOf(address(this));
        if (leftover > 0) {
            _safeTransfer(rewardToken, msg.sender, leftover);
        }

        if (veBtcTokenId > 0) {
            boostVoter.pokeBoost(veBtcTokenId);
            if (pokePoolsVoter && veBTC.isApprovedOrOwner(msg.sender, veBtcTokenId) && veBTC.isApprovedOrOwner(address(this), veBtcTokenId)) {
                poolsVoter.poke(veBtcTokenId);
            }
        }

        emit CrossPairBribePosted(msg.sender, gauge, rewardToken, amount, veBtcTokenId);
    }
}
